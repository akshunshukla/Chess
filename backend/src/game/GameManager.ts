import { prisma, redis, redisOperation } from "../db/index.ts";
import { gamePgn, timeoutResult, validateMove } from "./ChessValidator.ts";
import { activateGameState, cleanupGame, gameIndexes, mutateGame, pendingFinalizations, readGame } from "./game.store.ts";
import { abortActiveGameRecord, activateGameRecord, finalizeGameRecord, saveGameSnapshot } from "./game.persistence.ts";
import { gameClocks, gameResync, serverNow } from "./game.clock.ts";
import { GameError, type GameCommand, type GameHooks, type GameState } from "./game.types.ts";
import { GameTasks } from "./game.tasks.ts";
import { playerKey } from "./matchmaking.types.ts";
import { TimerManager } from "./TimerManager.ts";
import { reconcileActiveGame } from "./game.recovery.ts";

export class GameManager {
  private readonly tasks = new GameTasks();
  private readonly snapshots = new Map<string, GameState>();
  private readonly timer: TimerManager;
  private running = false;
  private reconcileAt = 0;
  private reconcileCursor: string | undefined;

  constructor(private readonly hooks: GameHooks) {
    this.timer = new TimerManager({
      run: (id, at) => this.expire(id, at),
      sync: (id, at) => this.sync(id, at),
      maintain: () => this.maintain(),
    });
  }
  start() { this.running = true; this.timer.start(); }
  pause() { this.running = false; this.timer.pause(); }
  async stop() { this.pause(); await this.timer.stop(); await this.tasks.drain(); }
  startGame(id: string) {
    return this.tasks.run(id, async () => {
      if (!this.running) return;
      await redisOperation(() => redis.zadd(gameIndexes.starting, serverNow(), id));
      const record = await activateGameRecord(id);
      if (!record) { await redisOperation(() => redis.zrem(gameIndexes.starting, id)); return; }
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
      if (state.status === "completed") { this.announceEnd(state); return; }
      if (state.moveCount) { this.broadcast(state, gameResync(state)); return; }
      this.broadcast(state, { type: "game:start", payload: {
        gameId: id, fen: state.fen, white: game.whitePlayer, black: game.blackPlayer,
        timeControl: game.timeControlSeconds, increment: game.incrementSeconds,
        startedAt: state.startedAt, moveCount: 0, ...gameClocks(state),
      } });
    });
  }
  handle(userId: string, ownerId: string, command: GameCommand, at: number) {
    return this.tasks.run(command.payload.gameId, async () => {
      if (!this.running) throw new GameError("GAME_UNAVAILABLE", "Game service is stopping");
      if (!await this.hooks.validate(userId, ownerId)) return;
      if (command.type === "game:reconnect") {
        await this.resync(userId, ownerId, command.payload.gameId); return;
      }
      const state = await this.requireGame(command.payload.gameId, userId);
      if (!this.hooks.isCurrent(userId, ownerId)) return;
      if (state.status !== "active") throw new GameError("GAME_NOT_ACTIVE", "This game is not active");
      const movingId = state.turn === "w" ? state.whiteId : state.blackId;
      const clocks = gameClocks(state, at);
      if ((state.turn === "w" ? clocks.whiteTime : clocks.blackTime) <= 0) {
        await this.timeout(state, at); return;
      }
      if (command.type === "game:move") {
        if (command.payload.expectedPly !== state.moveCount) throw new GameError("STALE_MOVE", "Resync before retrying this move");
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
    const state = await readGame(id);
    if (state) {
      if (state.whiteId !== userId && state.blackId !== userId) throw new GameError("GAME_FORBIDDEN", "You are not a player in this game");
      if (this.hooks.isCurrent(userId, ownerId)) this.hooks.send(userId, gameResync(state), ownerId);
      return;
    }
    const game = await prisma.game.findUnique({ where: { id } });
    if (!game) throw new GameError("GAME_NOT_FOUND", "Game is unavailable");
    if (game.whitePlayerId !== userId && game.blackPlayerId !== userId) throw new GameError("GAME_FORBIDDEN", "You are not a player in this game");
    if (game.status !== "completed" && game.status !== "aborted") throw new GameError("GAME_UNAVAILABLE", "Game recovery is pending");
    if (this.hooks.isCurrent(userId, ownerId)) this.hooks.send(userId, { type: "game:over", payload: {
      gameId: id, status: game.status, result: game.result, reason: game.resultReason,
      pgn: game.pgn, fen: game.finalFen,
    } }, ownerId);
  }
  private async move(state: GameState, actorId: string, input: Extract<GameCommand, { type: "game:move" }>["payload"], at: number) {
    const move = validateMove(state, input);
    const nextId = move.turn === "w" ? state.whiteId : state.blackId;
    const updated = await mutateGame(state, {
      kind: "move", actorId, at, move, nextLagMs: this.hooks.lag(nextId),
      timeoutResult: state.turn === "w" ? "black_win" : "white_win",
    });
    const played = updated.moves[updated.moveCount - 1]!;
    this.broadcast(updated, { type: "game:move", payload: {
      gameId: updated.id, from: played.from, to: played.to, promotion: played.promotion,
      san: played.san, fen: updated.fen, moveCount: updated.moveCount, ...gameClocks(updated),
    } });
    if (updated.status === "completed") this.announceEnd(updated);
    else if (updated.moveCount % 10 === 0) this.snapshots.set(updated.id, updated);
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
    if (updated.status === "completed") this.announceEnd(updated);
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
    this.snapshots.delete(state.id);
    this.broadcast(state, { type: "game:over", payload: {
      gameId: state.id, ...state.outcome, pgn: gamePgn(state),
      fen: state.fen, moveCount: state.moveCount, ...gameClocks(state),
    } });
  }
  private async timeout(state: GameState, at: number) {
    const updated = await mutateGame(state, { kind: "timeout", at, timeoutResult: timeoutResult(state) });
    if (updated.status === "completed") this.announceEnd(updated);
  }
  private expire(id: string, at: number) {
    return this.tasks.run(id, async () => {
      const state = await readGame(id);
      if (state?.status === "active") await this.timeout(state, at);
      else await redisOperation(() => redis.zrem(gameIndexes.deadlines, id));
    });
  }
  private sync(id: string, at: number) {
    return this.tasks.run(id, async () => {
      const state = await readGame(id);
      if (state?.status !== "active") return;
      this.broadcast(state, { type: "game:time", payload: {
        gameId: id, moveCount: state.moveCount, turn: state.turn, ...gameClocks(state, at),
      } });
    });
  }
  async resume(userId: string, ownerId: string) {
    let id = await redisOperation(() => redis.get(playerKey(userId)));
    if (!id) {
      const game = await prisma.game.findFirst({ where: {
        status: "active", OR: [{ whitePlayerId: userId }, { blackPlayerId: userId }],
      }, select: { id: true } });
      id = game?.id ?? null;
    }
    if (!id) return;
    await this.tasks.run(id, async () => {
      const state = await this.requireGame(id!, userId);
      if (state.status !== "waiting" && this.hooks.isCurrent(userId, ownerId)) {
        this.hooks.send(userId, gameResync(state), ownerId);
      }
    });
  }
  private async maintain() {
    if (!this.running) return;
    const starts = await redisOperation(() => redis.zrangebyscore(gameIndexes.starting, "-inf", serverNow(), "LIMIT", 0, 8));
    for (const id of starts) {
      try { await this.startGame(id); }
      catch (error) {
        console.error("Game activation deferred:", error);
        await redisOperation(() => redis.zadd(gameIndexes.starting, "XX", serverNow() + 2000, id));
      }
    }
    for (const id of await pendingFinalizations(8)) {
      try { await this.finalize(id); }
      catch (error) {
        console.error("Game persistence deferred:", error);
        await redisOperation(() => redis.zadd(gameIndexes.pending, "XX", serverNow() + 2000, id));
      }
    }
    for (const [id, state] of [...this.snapshots].slice(0, 8)) {
      try {
        await saveGameSnapshot(state);
        if (this.snapshots.get(id) === state) this.snapshots.delete(id);
      } catch (error) {
        console.error("Game checkpoint deferred:", error);
        if (this.snapshots.get(id) === state) { this.snapshots.delete(id); this.snapshots.set(id, state); }
      }
    }
    if (serverNow() >= this.reconcileAt) {
      this.reconcileAt = serverNow() + 5000;
      await this.reconcile();
    }
  }
  private async finalize(id: string) {
    const state = await readGame(id);
    if (!state) { await redisOperation(() => redis.zrem(gameIndexes.pending, id)); return; }
    if (state.status !== "completed") throw new GameError("GAME_INVALID_STATE", "Pending result is not terminal");
    const players = await prisma.game.findUnique({ where: { id }, select: {
      whitePlayer: { select: { username: true } }, blackPlayer: { select: { username: true } },
    } });
    if (!players) throw new GameError("GAME_NOT_FOUND", "Completed game record is missing");
    const pgn = gamePgn(state, { white: players.whitePlayer.username, black: players.blackPlayer.username });
    await finalizeGameRecord(state, pgn);
    await cleanupGame(state);
  }
  private async reconcile() {
    const games = await prisma.game.findMany({ where: {
      status: "active", ...(this.reconcileCursor ? { id: { gt: this.reconcileCursor } } : {}),
    }, orderBy: { id: "asc" }, take: 16,
      select: { id: true, whitePlayerId: true, blackPlayerId: true } });
    this.reconcileCursor = games.length ? games[games.length - 1]!.id : undefined;
    for (const game of games) {
      if (await this.healthy(game.id)) continue;
      await this.tasks.run(game.id, async () => {
        await reconcileActiveGame(game.id);
        const record = await prisma.game.findUnique({ where: { id: game.id }, select: { status: true } });
        if (record?.status === "aborted") {
          this.snapshots.delete(game.id);
          const message = { type: "game:over", payload: {
            gameId: game.id, status: "aborted", result: null, reason: "server_crash", pgn: null,
          } };
          this.hooks.send(game.whitePlayerId, message);
          this.hooks.send(game.blackPlayerId, message);
        }
      });
    }
  }
  private async healthy(id: string) {
    let state: GameState | null;
    try { state = await readGame(id); }
    catch (error) {
      if (!(error instanceof GameError) || error.code !== "GAME_INVALID_STATE") throw error;
      return false;
    }
    if (state?.status !== "active") return false;
    const [white, black, deadline] = await redisOperation(() => Promise.all([
      redis.get(playerKey(state.whiteId)), redis.get(playerKey(state.blackId)),
      redis.zscore(gameIndexes.deadlines, id),
    ]));
    return white === id && black === id && deadline !== null;
  }
}
