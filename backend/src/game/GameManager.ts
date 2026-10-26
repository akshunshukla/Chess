import { prisma, redis, redisOperation } from "../db/index.ts";
import { gamePgn, timeoutResult, validateMove } from "./ChessValidator.ts";
import { activateGameState, cleanupGame, gameIndexes, mutateGame, pendingFinalizations, readGame } from "./game.store.ts";
import { abortActiveGameRecord, activateGameRecord, finalizeGameRecord } from "./game.persistence.ts";
import { gameClocks, gameResync, serverNow } from "./game.clock.ts";
import { GameError, type GameCommand, type GameHooks, type GameState } from "./game.types.ts";
import { GameTasks } from "./game.tasks.ts";
import { playerKey } from "./matchmaking.types.ts";
import { TimerManager } from "./TimerManager.ts";
import { ReconnectionManager } from "./ReconnectionManager.ts";

export class GameManager {
  private readonly tasks = new GameTasks();
  private readonly timer: TimerManager;
  private readonly reconnections: ReconnectionManager;
  private readonly presenceTasks = new Set<Promise<void>>();
  private readonly presenceRetries = new Map<string, object>();
  private readonly timerRepairs = new Set<string>();
  private readonly cancellations = new Set<string>();
  private running = false;

  constructor(private readonly hooks: GameHooks) {
    this.reconnections = new ReconnectionManager(hooks);
    this.timer = new TimerManager({
      run: (id, count) => this.expire(id, count),
      abandon: (id) => this.abandon(id),
      sync: (id, at) => this.sync(id, at),
      maintain: () => this.maintain(),
    });
  }
  start() { this.running = true; this.timer.start(); }
  pause() { this.running = false; this.timer.pause(); }
  async stop() {
    this.pause();
    await this.timer.stop();
    while (this.presenceTasks.size) await Promise.allSettled([...this.presenceTasks]);
    await this.tasks.drain();
  }
  runExclusive<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    return this.tasks.run(gameId, fn).catch((error) => {
      // A Redis reply may be lost after the move committed. Re-read before
      // trusting the old timer's move count, once storage is reachable again.
      if (error instanceof GameError && error.code === "GAME_UNAVAILABLE") this.timerRepairs.add(gameId);
      throw error;
    });
  }
  cancelGame(id: string): Promise<void> {
    this.cancellations.add(id);
    return this.runExclusive(id, async () => {
      this.timer.clear(id);
      await abortActiveGameRecord(id);
      const game = await prisma.game.findUnique({ where: { id }, select: {
        whitePlayerId: true, blackPlayerId: true,
      } });
      if (game) {
        this.reconnections.forget(game.whitePlayerId);
        this.reconnections.forget(game.blackPlayerId);
        await cleanupGame({ id, whiteId: game.whitePlayerId, blackId: game.blackPlayerId });
      }
      this.cancellations.delete(id);
      this.timerRepairs.delete(id);
    });
  }
  startGame(id: string) {
    return this.runExclusive(id, async () => {
      if (!this.running) throw new GameError("GAME_UNAVAILABLE", "Game service is stopping");
      const record = await activateGameRecord(id);
      if (!record) throw new GameError("GAME_NOT_ACTIVE", "Game is no longer available");
      const { game, startedAt } = record;
      let state: GameState;
      try {
        state = await activateGameState(id, game.whitePlayerId, game.blackPlayerId, startedAt, this.hooks.lag(game.whitePlayerId));
      } catch (error) {
        if (error instanceof GameError && ["GAME_MISSING", "GAME_INVALID_STATE"].includes(error.code)) {
          await abortActiveGameRecord(id);
          await cleanupGame({ id, whiteId: game.whitePlayerId, blackId: game.blackPlayerId });
        }
        throw error;
      }
      state = await this.settleConnections(state, serverNow());
      if (state.status === "completed") return;
      this.timer.arm(state);
      if (state.moveCount) { this.broadcast(state, gameResync(state)); return; }
      this.broadcast(state, { type: "game:start", payload: {
        gameId: id, fen: state.fen, white: game.whitePlayer, black: game.blackPlayer,
        timeControl: game.timeControlSeconds, increment: game.incrementSeconds,
        startedAt: state.startedAt, moveCount: 0, ...gameClocks(state),
      } });
    });
  }
  handle(userId: string, ownerId: string, command: GameCommand, at: number) {
    return this.runExclusive(command.payload.gameId, async () => {
      if (!this.running) throw new GameError("GAME_UNAVAILABLE", "Game service is stopping");
      if (!await this.hooks.validate(userId, ownerId)) return;
      if (command.type === "game:reconnect") {
        await this.resync(userId, ownerId, command.payload.gameId); return;
      }
      let state = await this.requireGame(command.payload.gameId, userId);
      if (!this.hooks.isCurrent(userId, ownerId)) return;
      if (state.status !== "active") throw new GameError("GAME_NOT_ACTIVE", "This game is not active");
      state = await this.settleConnections(state, at);
      if (!this.hooks.isCurrent(userId, ownerId)) return;
      if (state.status !== "active") return;
      const movingId = state.turn === "w" ? state.whiteId : state.blackId;
      const clocks = gameClocks(state, at);
      if ((state.turn === "w" ? clocks.whiteTime : clocks.blackTime) <= 0) {
        await this.timeout(state, at); return;
      }
      if (command.type === "game:move") {
        if (command.payload.expectedPly !== undefined && command.payload.expectedPly !== state.moveCount) {
          console.warn(`Stale client move for game ${state.id}`);
          throw new GameError("STALE_MOVE", "Resync before retrying this move");
        }
        if (movingId !== userId) throw new GameError("WRONG_TURN", "Wait for your turn");
        await this.move(state, userId, command.payload, at);
      } else await this.nonMove(state, userId, command, at);
    });
  }
  private async requireGame(id: string, userId?: string) {
    const state = await readGame(id);
    if (!state) throw new GameError("GAME_NOT_FOUND", "Game is unavailable");
    if (userId && state.whiteId !== userId && state.blackId !== userId) {
      throw new GameError("GAME_FORBIDDEN", "You are not a player in this game");
    }
    return state;
  }
  private async resync(userId: string, ownerId: string, id: string) {
    let state = await readGame(id);
    if (state) {
      if (state.whiteId !== userId && state.blackId !== userId) throw new GameError("GAME_FORBIDDEN", "You are not a player in this game");
      if (this.hooks.isCurrent(userId, ownerId)) state = await this.settleConnections(state, serverNow());
      if (state.status !== "completed" && this.hooks.isCurrent(userId, ownerId)) this.hooks.send(userId, gameResync(state), ownerId);
      return;
    }
    const game = await prisma.game.findUnique({ where: { id } });
    if (!game) throw new GameError("GAME_NOT_FOUND", "Game is unavailable");
    if (game.whitePlayerId !== userId && game.blackPlayerId !== userId) throw new GameError("GAME_FORBIDDEN", "You are not a player in this game");
    if (game.status !== "completed" && game.status !== "aborted") throw new GameError("GAME_UNAVAILABLE", "Game state is temporarily unavailable");
    if (this.hooks.isCurrent(userId, ownerId)) this.hooks.send(userId, { type: "game:over", payload: {
      gameId: id, status: game.status, result: game.result, reason: game.resultReason,
      pgn: game.pgn, fen: game.finalFen,
    } }, ownerId);
  }
  private async move(state: GameState, actorId: string, input: Extract<GameCommand, { type: "game:move" }>["payload"], at: number) {
    const move = validateMove(state, input);
    const updated = await mutateGame(state, {
      kind: "move", actorId, at, move, estimatedLagMs: this.hooks.lag(actorId),
      timeoutResult: state.turn === "w" ? "black_win" : "white_win",
    });
    if (updated.moveCount === state.moveCount) {
      if (updated.status === "completed") await this.finish(updated);
      return;
    }
    const played = updated.moves[updated.moveCount - 1]!;
    this.broadcast(updated, { type: "game:move", payload: {
      gameId: updated.id, from: played.from, to: played.to, promotion: played.promotion,
      san: played.san, fen: updated.fen, moveCount: updated.moveCount, ...gameClocks(updated),
    } });
    if (updated.status === "completed") await this.finish(updated);
    else this.timer.arm(updated);
  }
  private async nonMove(state: GameState, actorId: string, command: Exclude<GameCommand, { type: "game:move" }>, at: number) {
    let kind: "finish" | "offer" | "decline";
    let outcome: GameState["outcome"];
    if (command.type === "game:resign") {
      kind = "finish";
      outcome = { result: actorId === state.whiteId ? "black_win" : "white_win", reason: "resignation" };
    } else if (command.type === "game:draw:offer") {
      if (state.drawOfferedBy) throw new GameError("DRAW_PENDING", "A draw offer is already pending");
      kind = "offer";
    } else if (command.type === "game:draw:respond") {
      if (!state.drawOfferedBy || state.drawOfferedBy === actorId) throw new GameError("NO_DRAW_OFFER", "There is no opponent draw offer");
      kind = command.payload.accept ? "finish" : "decline";
      if (command.payload.accept) outcome = { result: "draw", reason: "draw_agreement" };
    } else return;
    const updated = await mutateGame(state, {
      kind, actorId, at, outcome, timeoutResult: state.turn === "w" ? "black_win" : "white_win",
    });
    if (updated.status === "completed") await this.finish(updated);
    else if (kind === "offer") this.broadcast(updated, {
      type: "game:draw:offered", payload: { gameId: state.id, offeredBy: actorId },
    });
    else this.broadcast(updated, gameResync(updated));
  }
  private broadcast(state: GameState, message: { type: string; payload: unknown }) {
    this.hooks.send(state.whiteId, message);
    this.hooks.send(state.blackId, message);
  }
  private announceEnd(state: GameState) {
    this.timer.clear(state.id);
    this.reconnections.forget(state.whiteId);
    this.reconnections.forget(state.blackId);
    this.broadcast(state, { type: "game:over", payload: {
      gameId: state.id, ...state.outcome, pgn: gamePgn(state),
      fen: state.fen, moveCount: state.moveCount, ...gameClocks(state),
    } });
  }
  private async timeout(state: GameState, at: number) {
    const updated = await mutateGame(state, { kind: "timeout", at, timeoutResult: timeoutResult(state) });
    if (updated.status === "completed") await this.finish(updated);
  }
  private async settleConnections(state: GameState, at: number): Promise<GameState> {
    const updated = await this.reconnections.settle(state, at);
    if (updated.status === "completed") await this.finish(updated);
    else this.timer.arm(updated);
    return updated;
  }
  private expire(id: string, armedForMoveCount: number) {
    return this.runExclusive(id, async () => {
      const state = await readGame(id);
      if (state?.status !== "active" || state.moveCount !== armedForMoveCount) return;
      const at = serverNow();
      const remaining = state.turn === "w" ? state.whiteTimeMs : state.blackTimeMs;
      if (at - state.lastMoveAt < remaining) { this.timer.arm(state); return; }
      const updated = await this.settleConnections(state, at);
      if (updated.status === "active") await this.timeout(updated, at);
    });
  }
  private abandon(id: string) {
    return this.runExclusive(id, async () => {
      const state = await readGame(id);
      if (state?.status === "active") await this.settleConnections(state, serverNow());
    });
  }
  private sync(id: string, at: number) {
    return this.runExclusive(id, async () => {
      const state = await readGame(id);
      if (state?.status !== "active") return;
      this.broadcast(state, { type: "game:time", payload: {
        gameId: id, moveCount: state.moveCount, turn: state.turn, ...gameClocks(state, at),
      } });
    });
  }
  resume(userId: string, ownerId: string): Promise<void> {
    return this.trackPresence(this.resumeConnection(userId, ownerId));
  }
  private trackPresence(task: Promise<void>): Promise<void> {
    this.presenceTasks.add(task);
    void task.then(() => this.presenceTasks.delete(task), () => this.presenceTasks.delete(task));
    return task;
  }
  private async resumeConnection(userId: string, ownerId: string) {
    if (!this.hooks.isCurrent(userId, ownerId)) return;
    this.reconnections.connected(userId);
    const intent = {};
    this.presenceRetries.set(userId, intent);
    const id = await this.playerGameId(userId);
    if (!id) { this.clearPresence(userId, intent, true); return; }
    await this.runExclusive(id, async () => {
      let state = await this.requireGame(id, userId);
      if (!this.hooks.isCurrent(userId, ownerId)) return;
      state = await this.settleConnections(state, serverNow());
      if (state.status !== "active") this.clearPresence(userId, intent, true);
      if (state.status === "active") this.hooks.send(userId, gameResync(state), ownerId);
    });
    this.clearPresence(userId, intent);
  }
  disconnected(userId: string, at: number): Promise<void> {
    return this.trackPresence(this.disconnectConnection(userId, at));
  }
  private async disconnectConnection(userId: string, at: number): Promise<void> {
    if (this.hooks.connectedAt(userId) !== undefined) return;
    this.reconnections.disconnected(userId, at);
    const intent = {};
    this.presenceRetries.set(userId, intent);
    await this.repairPresence(userId, intent);
  }
  private clearPresence(userId: string, intent: object, forget = false): void {
    if (this.presenceRetries.get(userId) !== intent) return;
    this.presenceRetries.delete(userId);
    if (forget) this.reconnections.forget(userId);
  }
  private async repairPresence(userId: string, intent: object): Promise<void> {
    const id = await this.playerGameId(userId);
    if (!id) { this.clearPresence(userId, intent, true); return; }
    await this.runExclusive(id, async () => {
      const state = await readGame(id);
      if (state?.status === "active" && [state.whiteId, state.blackId].includes(userId)) {
        await this.settleConnections(state, serverNow());
      } else this.clearPresence(userId, intent, true);
    });
    this.clearPresence(userId, intent);
  }
  private async playerGameId(userId: string): Promise<string | null> {
    let id = await redisOperation(() => redis.get(playerKey(userId)));
    if (!id) {
      const game = await prisma.game.findFirst({ where: {
        status: "active", OR: [{ whitePlayerId: userId }, { blackPlayerId: userId }],
      }, select: { id: true } });
      id = game?.id ?? null;
    }
    return id;
  }
  private async maintain() {
    if (!this.running) return;
    for (const id of [...this.cancellations].slice(0, 8)) {
      try { await this.cancelGame(id); }
      catch (error) { console.error("Game cancellation cleanup deferred:", error); }
    }
    for (const id of [...this.timerRepairs].slice(0, 8)) {
      if (this.cancellations.has(id)) continue;
      try {
        await this.runExclusive(id, async () => {
          const state = await readGame(id);
          if (state?.status === "active") this.timer.arm(state);
          else this.timer.clear(id);
        });
        this.timerRepairs.delete(id);
      } catch (error) { console.error("Game timer repair deferred:", error); }
    }
    for (const [userId, intent] of [...this.presenceRetries].slice(0, 8)) {
      try { await this.repairPresence(userId, intent); }
      catch (error) {
        console.error("Game presence repair deferred:", error);
        if (this.presenceRetries.get(userId) === intent) {
          this.presenceRetries.delete(userId);
          this.presenceRetries.set(userId, intent);
        }
      }
    }
    for (const id of await pendingFinalizations(8)) {
      try { await this.runExclusive(id, () => this.finalize(id)); }
      catch (error) {
        console.error("Game persistence deferred:", error);
        await redisOperation(() => redis.zadd(gameIndexes.pending, "XX", serverNow() + 2000, id));
      }
    }
  }
  private async finalize(id: string) {
    const state = await readGame(id);
    if (!state) { await redisOperation(() => redis.zrem(gameIndexes.pending, id)); return; }
    if (state.status !== "completed") throw new GameError("GAME_INVALID_STATE", "Pending result is not terminal");
    await this.finish(state);
  }
  // Called only inside runExclusive. Clearing timers precedes database I/O.
  private async finish(state: GameState): Promise<void> {
    this.timer.clear(state.id);
    const players = await prisma.game.findUnique({ where: { id: state.id }, select: {
      whitePlayer: { select: { username: true } }, blackPlayer: { select: { username: true } },
    } });
    if (!players) throw new GameError("GAME_NOT_FOUND", "Completed game record is missing");
    const pgn = gamePgn(state, { white: players.whitePlayer.username, black: players.blackPlayer.username });
    await finalizeGameRecord(state, pgn);
    await cleanupGame(state);
    this.announceEnd(state);
  }
}
