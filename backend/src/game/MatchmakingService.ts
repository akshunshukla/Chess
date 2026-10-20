import { randomInt, randomUUID } from "node:crypto";
import { prisma, redis, redisOperation } from "../db/index.ts";
import { HttpError } from "../utils/errors.ts";
import {
  abortWaitingGame,
  GameUnavailableError,
  getWaitingGame,
  listWaitingGames,
  matchedMessage,
  prepareWaitingGame,
  type WaitingGame,
} from "./GameService.ts";
import {
  addQueuePlayer,
  candidateIds,
  finishReservation,
  initializeGame,
  markCancellation,
  readQueuePlayer,
  readReservation,
  removeQueuePlayer,
  removeWaitingGame,
  reservePair,
} from "./matchmaking.store.ts";
import {
  BATCH_SIZE,
  gameKey,
  playerKey,
  queueKeys,
  ratingWindow,
  reservedKey,
  type MatchmakingHooks,
  type QueuePlayer,
  type Reservation,
} from "./matchmaking.types.ts";

export async function joinQueue(
  userId: string,
  ownerId: string,
  isCurrent: () => boolean = () => true,
  joinedAt = Date.now(),
): Promise<"joined" | "already_queued" | "busy" | "stale"> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { rating: true },
  });
  if (!user) throw new HttpError(401, "Account unavailable");
  const busy = await prisma.game.findFirst({
    where: {
      status: { in: ["waiting", "active"] },
      OR: [{ whitePlayerId: userId }, { blackPlayerId: userId }],
    },
    select: { id: true },
  });
  // Recheck after database awaits, immediately before submitting the Redis write.
  if (!isCurrent()) return "stale";
  if (busy) return "busy";
  const result = await addQueuePlayer({
    userId,
    ownerId,
    rating: user.rating,
    joinedAt,
  });
  if (result === 1) return "joined";
  if (result === 0) return "already_queued";
  if (result === -1) return "busy";
  throw new HttpError(503, "Unexpected matchmaking result");
}

export async function leaveQueue(
  userId: string,
  ownerId: string,
): Promise<"left" | "not_queued" | "busy"> {
  const result = await removeQueuePlayer(userId, ownerId);
  if (result === 1) return "left";
  if (result === 0) return "not_queued";
  if (result === -1) return "busy";
  throw new HttpError(503, "Unexpected matchmaking result");
}

export const findCandidates = candidateIds;

interface QueueIntent {
  ownerId: string;
  wanted: boolean;
}

export class MatchmakingService {
  private active = false;
  private interval: ReturnType<typeof setInterval> | undefined;
  private tail: Promise<void> = Promise.resolve();
  private passQueued = false;
  private anchorOffset = 0;
  private readonly candidatePages = new Map<string, number>();
  private readonly intents = new Map<string, QueueIntent>();
  private intentCursor: MapIterator<[string, QueueIntent]> | undefined;
  private waitingCursor: string | undefined;
  private nextReconcile = 0;

  constructor(private readonly hooks: MatchmakingHooks) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.interval = setInterval(() => this.kick(), 500);
    this.interval.unref();
    this.kick();
  }

  pause() {
    this.active = false;
    clearInterval(this.interval);
  }

  async stop() {
    this.pause();
    let last: Promise<void>;
    do {
      last = this.tail;
      await last;
    } while (last !== this.tail);
  }

  requested(
    userId: string,
    ownerId: string,
    command: "queue:join" | "queue:leave",
  ) {
    if (command === "queue:join")
      this.intents.set(userId, { ownerId, wanted: true });
    else if (
      this.intents.get(userId)?.ownerId === ownerId ||
      this.hooks.isCurrent(userId, ownerId)
    ) {
      this.intents.set(userId, { ownerId, wanted: false });
      this.candidatePages.delete(userId);
    }
  }

  kick() {
    if (!this.active || this.passQueued) return;
    this.passQueued = true;
    void this.enqueue(async () => {
      this.passQueued = false;
      if (this.active) await this.runPass();
    }).catch((error) => console.error("Matchmaking worker failed:", error));
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => {});
    return result;
  }

  private wantsMatch(player: QueuePlayer) {
    const intent = this.intents.get(player.userId);
    return (
      this.active &&
      intent !== undefined &&
      intent.wanted &&
      intent.ownerId === player.ownerId &&
      this.hooks.isCurrent(player.userId, player.ownerId)
    );
  }

  private async eligible(player: QueuePlayer) {
    return (
      this.wantsMatch(player) &&
      (await this.hooks.validate(player.userId, player.ownerId)) &&
      this.wantsMatch(player)
    );
  }

  private async runPass() {
    if (Date.now() >= this.nextReconcile) {
      this.nextReconcile = Date.now() + 5000;
      await this.reconcileWaiting();
      await this.restoreQueueIntents();
    }
    const pending = await redisOperation(() =>
      redis.zrangebyscore(queueKeys.pending, "-inf", Date.now(), "LIMIT", 0, 8),
    );
    for (const id of pending) {
      if (!this.active) return;
      await this.processPending(id);
    }
    const count = await redisOperation(() => redis.zcard(queueKeys.waiting));
    if (!count) {
      this.anchorOffset = 0;
      return;
    }
    this.anchorOffset %= count;
    const anchors = await redisOperation(() =>
      redis.zrange(
        queueKeys.waiting,
        this.anchorOffset,
        String(this.anchorOffset + BATCH_SIZE - 1),
      ),
    );
    const deadline = Date.now() + 200;
    let processed = 0;
    let matches = 0;
    for (const userId of anchors) {
      if (!this.active || Date.now() > deadline || matches >= 8) break;
      processed++;
      const player = await readQueuePlayer(userId);
      if (!player) {
        this.candidatePages.delete(userId);
        const owner = await redisOperation(() =>
          redis.hget(queueKeys.owners, userId),
        );
        await removeQueuePlayer(userId, owner ?? "");
        continue;
      }
      if (!(await this.eligible(player))) {
        this.candidatePages.delete(userId);
        await removeQueuePlayer(userId, player.ownerId);
        continue;
      }
      const page = this.candidatePages.get(userId) ?? 0;
      this.candidatePages.set(userId, (page + 1) % 1_000_000);
      const ids = await candidateIds(userId, page);
      const candidates = (await Promise.all(ids.map(readQueuePlayer)))
        .filter((candidate): candidate is QueuePlayer => candidate !== null)
        .sort(
          (a, b) =>
            a.joinedAt - b.joinedAt ||
            Math.abs(a.rating - player.rating) -
              Math.abs(b.rating - player.rating),
        );
      for (const candidate of candidates) {
        const now = Date.now();
        if (
          Math.abs(player.rating - candidate.rating) >
          Math.min(
            ratingWindow(player.joinedAt, now),
            ratingWindow(candidate.joinedAt, now),
          )
        )
          continue;
        if (!(await this.eligible(candidate)) || !this.wantsMatch(player))
          continue;
        const [white, black] =
          randomInt(2) === 0 ? [player, candidate] : [candidate, player];
        const reservation = { id: randomUUID(), white, black, createdAt: now };
        if (await reservePair(reservation)) {
          this.candidatePages.delete(player.userId);
          this.candidatePages.delete(candidate.userId);
          await this.processPending(reservation.id);
          matches++;
          break;
        }
      }
    }
    this.anchorOffset += processed;
  }

  private async processPending(id: string) {
    try {
      const reservation = await readReservation(id);
      if (!reservation) {
        await redisOperation(() => redis.zrem(queueKeys.pending, id));
        return;
      }
      if (reservation.cancelReason) {
        await this.cancel(reservation, reservation.cancelReason);
        return;
      }
      if (
        Date.now() - reservation.createdAt > 30000 ||
        !(await this.eligible(reservation.white)) ||
        !(await this.eligible(reservation.black))
      ) {
        await this.cancel(reservation, "abandonment");
        return;
      }
      const game = await prepareWaitingGame(reservation);
      if (game.status !== "waiting") {
        if (game.status === "aborted")
          await this.cancel(reservation, "abandonment");
        else await finishReservation(reservation);
        return;
      }
      if (!(await initializeGame(reservation)))
        throw new Error("Could not initialize reserved game");
      if (
        !(await this.eligible(reservation.white)) ||
        !(await this.eligible(reservation.black))
      ) {
        await this.cancel(reservation, "abandonment");
        return;
      }
      const sentWhite = this.hooks.send(
        game.whitePlayerId,
        matchedMessage(game, game.whitePlayerId),
        reservation.white.ownerId,
      );
      const sentBlack = this.hooks.send(
        game.blackPlayerId,
        matchedMessage(game, game.blackPlayerId),
        reservation.black.ownerId,
      );
      if (!sentWhite || !sentBlack) {
        await this.cancel(reservation, "abandonment");
        return;
      }
      // Notification is at least once: an uncertain finalization retries the
      // same match ID instead of creating a second game.
      await finishReservation(reservation);
    } catch (error) {
      if (error instanceof GameUnavailableError) {
        const reservation = await readReservation(id);
        if (reservation) {
          await this.cancel(reservation, "abandonment");
          return;
        }
      }
      console.error(`Matchmaking reservation ${id} deferred:`, error);
      await redisOperation(() =>
        redis.zadd(queueKeys.pending, "XX", Date.now() + 2000, id),
      );
    }
  }

  private async cancel(
    reservation: Reservation,
    reason: "abandonment" | "server_crash",
  ) {
    await markCancellation(reservation, reason);
    const aborted = await abortWaitingGame(reservation, reason);
    if (aborted)
      await removeWaitingGame(
        reservation.id,
        reservation.white.userId,
        reservation.black.userId,
      );
    await finishReservation(reservation);
    if (!aborted) return;
    for (const player of [reservation.white, reservation.black]) {
      this.hooks.send(player.userId, {
        type: "queue:cancelled",
        payload: { gameId: reservation.id, reason },
      });
      try {
        if (!(await this.eligible(player))) continue;
        const status = await joinQueue(
          player.userId,
          player.ownerId,
          () => this.wantsMatch(player),
          player.joinedAt,
        );
        if (
          this.hooks.isCurrent(player.userId, player.ownerId) &&
          status !== "stale"
        ) {
          this.hooks.send(
            player.userId,
            {
              type: "queue:status",
              payload: { command: "queue:join", status },
            },
            player.ownerId,
          );
        }
      } catch (error) {
        console.error("Matchmaking requeue deferred:", error);
        this.hooks.send(
          player.userId,
          {
            type: "error",
            payload: {
              code: "MATCHMAKING_UNAVAILABLE",
              message: "Rejoining the queue will be retried.",
            },
          },
          player.ownerId,
        );
      }
    }
  }

  private async reconcileWaiting() {
    const games = await listWaitingGames(this.waitingCursor);
    this.waitingCursor = games.length ? games[games.length - 1]!.id : undefined;
    for (const game of games) {
      const reservation = await this.reservationForGame(game);
      const state = await redisOperation(() => redis.hgetall(gameKey(game.id)));
      const [whiteMapping, blackMapping] = await redisOperation(() =>
        redis.mget(
          playerKey(game.whitePlayerId),
          playerKey(game.blackPlayerId),
        ),
      );
      const connected =
        reservation.white.ownerId &&
        reservation.black.ownerId &&
        (await this.hooks.validate(
          game.whitePlayerId,
          reservation.white.ownerId,
        )) &&
        (await this.hooks.validate(
          game.blackPlayerId,
          reservation.black.ownerId,
        ));
      if (
        !connected ||
        state.status !== "waiting" ||
        state.white_id !== game.whitePlayerId ||
        state.black_id !== game.blackPlayerId ||
        whiteMapping !== game.id ||
        blackMapping !== game.id
      ) {
        await this.cancel(
          reservation,
          connected ? "server_crash" : "abandonment",
        );
      }
    }
  }

  private async restoreQueueIntents() {
    this.intentCursor ??= this.intents.entries();
    for (let i = 0; i < 8; i++) {
      const next = this.intentCursor.next();
      if (next.done) {
        this.intentCursor = undefined;
        break;
      }
      const [userId, intent] = next.value;
      const { ownerId } = intent;
      if (!intent.wanted || !this.hooks.isCurrent(userId, ownerId)) continue;
      const [queued, reserved, playing] = await redisOperation(() =>
        Promise.all([
          redis.zscore(queueKeys.ratings, userId),
          redis.get(reservedKey(userId)),
          redis.get(playerKey(userId)),
        ]),
      );
      if (queued !== null || reserved !== null || playing !== null) continue;
      if (!(await this.hooks.validate(userId, ownerId))) continue;
      const status = await joinQueue(
        userId,
        ownerId,
        () =>
          this.active &&
          this.intents.get(userId) === intent &&
          this.hooks.isCurrent(userId, ownerId),
      );
      if (status === "joined" || status === "already_queued") {
        this.hooks.send(
          userId,
          { type: "queue:status", payload: { command: "queue:join", status } },
          ownerId,
        );
      }
    }
  }

  private async reservationForGame(game: WaitingGame): Promise<Reservation> {
    const state = await redisOperation(() => redis.hgetall(gameKey(game.id)));
    const joinedAt = (value: string | undefined) =>
      value !== undefined && Number.isFinite(Number(value))
        ? Number(value)
        : game.createdAt.getTime();
    return {
      id: game.id,
      createdAt: game.createdAt.getTime(),
      white: {
        userId: game.whitePlayerId,
        ownerId: this.hooks.currentOwner(game.whitePlayerId) ?? "",
        rating: game.whitePlayer.rating,
        joinedAt: joinedAt(state.white_joined_at),
      },
      black: {
        userId: game.blackPlayerId,
        ownerId: this.hooks.currentOwner(game.blackPlayerId) ?? "",
        rating: game.blackPlayer.rating,
        joinedAt: joinedAt(state.black_joined_at),
      },
    };
  }

  disconnected(userId: string, ownerId: string) {
    if (this.intents.get(userId)?.ownerId === ownerId)
      this.intents.delete(userId);
    return this.enqueue(async () => {
      if (this.hooks.currentOwner(userId)) return;
      const game = await getWaitingGame(userId);
      if (game && !this.hooks.currentOwner(userId))
        await this.cancel(await this.reservationForGame(game), "abandonment");
    });
  }

  resume(userId: string, ownerId: string) {
    const previousIntent = this.intents.get(userId);
    return this.enqueue(async () => {
      if (!this.active || !this.hooks.isCurrent(userId, ownerId)) return;
      const game = await getWaitingGame(userId);
      if (!game || !this.hooks.isCurrent(userId, ownerId)) return;
      const state = await redisOperation(() => redis.hgetall(gameKey(game.id)));
      if (!this.hooks.isCurrent(userId, ownerId)) return;
      if (
        state.status === "waiting" &&
        state.white_id === game.whitePlayerId &&
        state.black_id === game.blackPlayerId
      ) {
        const currentIntent = this.intents.get(userId);
        if (
          currentIntent === previousIntent ||
          currentIntent?.ownerId !== ownerId
        ) {
          this.intents.set(userId, { ownerId, wanted: true });
        }
        this.hooks.send(userId, matchedMessage(game, userId), ownerId);
      } else {
        await this.cancel(await this.reservationForGame(game), "server_crash");
      }
    });
  }
}
