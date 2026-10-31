import { randomInt, randomUUID } from "node:crypto";
import { prisma, redis, redisOperation } from "../db/index.ts";
import { HttpError } from "../utils/errors.ts";
import { abortWaitingGame, matchedMessage, prepareWaitingGame } from "./GameService.ts";
import {
  addQueuePlayer, claimOpponent, discardWaitingGame, initializeGame, removeQueuePlayer,
} from "./matchmaking.store.ts";
import {
  MATCHMAKING, TIME_CONTROL_SECONDS, playerKey, queueKey, ratingWindow,
  type MatchmakingHooks, type MatchPair, type QueuePlayer,
} from "./matchmaking.types.ts";

interface QueueIntent { ownerId: string; wanted: boolean }
type JoinStatus = "joined" | "already_queued" | "busy" | "stale";
type LeaveStatus = "left" | "not_queued" | "busy";

export class MatchmakingService {
  private active = false;
  private interval?: ReturnType<typeof setInterval>;
  private tail: Promise<void> = Promise.resolve();
  private passQueued = false;
  private readonly waiting = new Map<string, QueuePlayer>();
  private readonly intents = new Map<string, QueueIntent>();
  private readonly lastPairAttempts = new WeakMap<QueuePlayer, number>();

  constructor(private readonly hooks: MatchmakingHooks) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.interval = setInterval(() => this.kick(), MATCHMAKING.tickMs);
    this.interval.unref();
  }

  pause(): void {
    this.active = false;
    clearInterval(this.interval);
    this.interval = undefined;
  }

  async stop(): Promise<void> {
    this.pause();
    let previous: Promise<void>;
    do { previous = this.tail; await previous; } while (previous !== this.tail);
    for (const userId of this.waiting.keys()) await removeQueuePlayer(userId);
    this.waiting.clear();
    this.intents.clear();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  requested(userId: string, ownerId: string, command: "queue:join" | "queue:leave"): void {
    if (command === "queue:join" || this.intents.get(userId)?.ownerId === ownerId || this.hooks.isCurrent(userId, ownerId)) {
      this.intents.set(userId, { ownerId, wanted: command === "queue:join" });
    }
  }

  isWaiting(userId: string, ownerId: string): boolean {
    const player = this.waiting.get(userId);
    return player?.ownerId === ownerId && this.wantsMatch(player);
  }

  joinQueue(userId: string, ownerId: string, isCurrent = () => true): Promise<JoinStatus> {
    const intent = this.intents.get(userId) ?? { ownerId, wanted: true };
    if (!this.intents.has(userId)) this.intents.set(userId, intent);
    return this.enqueue(async () => {
      const current = () => this.active && isCurrent() && this.hooks.isCurrent(userId, ownerId) &&
        this.intents.get(userId) === intent && intent.wanted;
      if (!current()) return "stale";
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { rating: true } });
      if (!user) throw new HttpError(401, "Account unavailable");
      const busy = await prisma.game.findFirst({ where: {
        status: { in: ["waiting", "active"] },
        OR: [{ whitePlayerId: userId }, { blackPlayerId: userId }],
      }, select: { id: true } });
      if (!current()) return "stale";
      if (busy) {
        await removeQueuePlayer(userId);
        this.waiting.delete(userId);
        this.clearIntent(userId, ownerId, intent);
        return "busy";
      }
      const existing = this.waiting.get(userId);
      const player: QueuePlayer = {
        userId, ownerId, rating: user.rating,
        joinedAt: existing?.joinedAt ?? Date.now(), timeControl: TIME_CONTROL_SECONDS,
      };
      const result = await addQueuePlayer(player);
      if (result === -1) {
        await removeQueuePlayer(userId);
        this.waiting.delete(userId);
        this.clearIntent(userId, ownerId, intent);
        return "busy";
      }
      this.waiting.set(userId, player);
      if (!current()) return "stale";
      await this.tryPair(player, MATCHMAKING.windows[0].rating);
      return result === 1 ? "joined" : "already_queued";
    });
  }

  leaveQueue(userId: string, ownerId: string): Promise<LeaveStatus> {
    return this.enqueue(async () => {
      const player = this.waiting.get(userId);
      const currentOwner = this.hooks.currentOwner(userId);
      if (currentOwner && currentOwner !== ownerId) return "not_queued";
      if (player && player.ownerId !== ownerId && currentOwner !== ownerId) return "not_queued";
      const intent = this.intents.get(userId);
      const removed = await removeQueuePlayer(userId);
      this.waiting.delete(userId);
      this.clearIntent(userId, ownerId, intent);
      if (removed || player) return "left";
      return await redisOperation(() => redis.exists(playerKey(userId))) ? "busy" : "not_queued";
    });
  }

  kick(): void {
    if (!this.active || this.passQueued) return;
    this.passQueued = true;
    void this.enqueue(async () => {
      this.passQueued = false;
      if (this.active) await this.runPass();
    }).catch((error) => console.error("Matchmaking failed:", error));
  }

  private clearIntent(userId: string, ownerId: string, expected = this.intents.get(userId)): void {
    if (expected?.ownerId === ownerId && this.intents.get(userId) === expected) this.intents.delete(userId);
  }

  private wantsMatch(player: QueuePlayer): boolean {
    const intent = this.intents.get(player.userId);
    return this.active && intent?.ownerId === player.ownerId && intent.wanted &&
      this.hooks.isCurrent(player.userId, player.ownerId);
  }

  private async eligible(player: QueuePlayer): Promise<boolean> {
    return this.wantsMatch(player) && await this.hooks.validate(player.userId, player.ownerId) && this.wantsMatch(player);
  }

  private async pairEligible(first: QueuePlayer, second: QueuePlayer): Promise<boolean> {
    const ready = await Promise.all([this.eligible(first), this.eligible(second)]);
    return ready.every(Boolean) && this.wantsMatch(first) && this.wantsMatch(second);
  }

  private forget(player: QueuePlayer, intent = this.intents.get(player.userId)): void {
    if (this.waiting.get(player.userId) === player) this.waiting.delete(player.userId);
    this.clearIntent(player.userId, player.ownerId, intent);
  }

  private error(userId: string): void {
    this.hooks.send(userId, { type: "error", payload: {
      code: "MATCHMAKING_UNAVAILABLE", message: "Unable to start the game. Join the queue again.",
    } });
  }

  private async runPass(): Promise<void> {
    for (const player of [...this.waiting.values()]) {
      if (!this.active) return;
      const at = Date.now();
      // Keep widening quickly at first, then reduce Redis work for long waits.
      if (at - player.joinedAt >= 20_000 && at - (this.lastPairAttempts.get(player) ?? 0) < 5_000) continue;
      await this.tryPair(player, ratingWindow(player.joinedAt));
    }
  }

  private async tryPair(player: QueuePlayer, window: number): Promise<void> {
    if (this.waiting.get(player.userId) !== player) return;
    this.lastPairAttempts.set(player, Date.now());
    const owner = this.hooks.currentOwner(player.userId);
    // A newly authenticated socket will transfer the entry in resume().
    if (owner && owner !== player.ownerId) return;
    const intent = this.intents.get(player.userId);
    if (!await this.eligible(player)) {
      const currentOwner = this.hooks.currentOwner(player.userId);
      if (currentOwner && currentOwner !== player.ownerId) return;
      await removeQueuePlayer(player.userId);
      this.forget(player, intent);
      return;
    }
    const opponentId = await claimOpponent(player.userId, window);
    if (!opponentId) {
      const queued = await redisOperation(() => redis.zscore(queueKey, player.userId));
      if (queued === null) { this.forget(player, intent); this.error(player.userId); }
      return;
    }
    const opponent = this.waiting.get(opponentId);
    this.waiting.delete(player.userId);
    this.waiting.delete(opponentId);
    if (!opponent) {
      this.forget(player, intent);
      this.error(player.userId);
      this.error(opponentId);
      console.warn("Paired opponent is no longer waiting:", opponentId);
      return;
    }
    await this.createMatch(player, opponent);
  }

  private async createMatch(first: QueuePlayer, second: QueuePlayer): Promise<void> {
    const [white, black] = randomInt(2) === 0 ? [first, second] : [second, first];
    const pair: MatchPair = { id: randomUUID(), white, black, createdAt: Date.now() };
    const firstIntent = this.intents.get(first.userId);
    const secondIntent = this.intents.get(second.userId);
    try {
      if (!await this.pairEligible(first, second)) throw new Error("Player left the queue");
      const game = await prepareWaitingGame(pair);
      await initializeGame(pair);
      if (!await this.pairEligible(first, second) || !this.wantsMatch(first) || !this.wantsMatch(second)) {
        throw new Error("Player disconnected before the game started");
      }
      const sentWhite = this.hooks.send(white.userId, matchedMessage(game, white.userId), white.ownerId);
      const sentBlack = this.hooks.send(black.userId, matchedMessage(game, black.userId), black.ownerId);
      if (!sentWhite || !sentBlack) throw new Error("Player disconnected before the game started");
      await this.hooks.activate(pair.id);
    } catch (error) {
      console.error(`Could not create matched game ${pair.id}:`, error);
      try {
        await this.hooks.cancel?.(pair.id);
      } catch (cleanupError) {
        console.error(`Could not cancel matched game ${pair.id}:`, cleanupError);
      }
      try {
        await abortWaitingGame(pair.id);
      } catch (cleanupError) {
        console.error(`Could not abort waiting game ${pair.id}:`, cleanupError);
      }
      try {
        await discardWaitingGame(pair);
      } catch (cleanupError) {
        console.error(`Could not discard waiting state ${pair.id}:`, cleanupError);
      }
      this.error(first.userId);
      this.error(second.userId);
    } finally {
      this.clearIntent(first.userId, first.ownerId, firstIntent);
      this.clearIntent(second.userId, second.ownerId, secondIntent);
    }
  }

  disconnected(userId: string, ownerId: string): Promise<void> {
    this.requested(userId, ownerId, "queue:leave");
    return this.enqueue(async () => {
      const player = this.waiting.get(userId);
      if (!player || player.ownerId !== ownerId || this.hooks.currentOwner(userId)) return;
      await removeQueuePlayer(userId);
      this.forget(player);
    });
  }

  resume(userId: string, ownerId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.active || !this.hooks.isCurrent(userId, ownerId)) return;
      const player = this.waiting.get(userId);
      if (!player) return;
      const intent = this.intents.get(userId);
      if (intent && !intent.wanted) {
        await removeQueuePlayer(userId);
        this.forget(player, intent);
        return;
      }
      this.waiting.set(userId, { ...player, ownerId });
      if (intent?.ownerId !== ownerId) this.intents.set(userId, { ownerId, wanted: true });
      this.hooks.send(userId, { type: "queue:status", payload: {
        command: "queue:join", status: "already_queued",
      } }, ownerId);
      this.kick();
    });
  }
}
