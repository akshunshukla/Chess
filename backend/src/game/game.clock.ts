import { performance } from "node:perf_hooks";
import { DISCONNECT_GRACE_MS, type GameState } from "./game.types.ts";

export const serverNow = () =>
  Math.floor(performance.timeOrigin + performance.now());

export function gameClocks(state: GameState, at = serverNow()) {
  let whiteTime = state.whiteTimeMs;
  let blackTime = state.blackTimeMs;
  if (state.status === "active") {
    const elapsed = Math.max(0, at - state.lastMoveAt - state.lagAllowanceMs);
    if (state.turn === "w") whiteTime = Math.max(0, whiteTime - elapsed);
    else blackTime = Math.max(0, blackTime - elapsed);
  }
  return { whiteTime, blackTime };
}

export function gameResync(state: GameState, at = serverNow()) {
  return {
    type: "game:resync",
    payload: {
      gameId: state.id,
      whiteId: state.whiteId,
      blackId: state.blackId,
      fen: state.fen,
      turn: state.turn,
      status: state.status,
      moves: state.moves,
      moveCount: state.moveCount,
      ...gameClocks(state, at),
      drawOfferedBy: state.drawOfferedBy,
      whiteDisconnectedAt: state.whiteDisconnectedAt,
      blackDisconnectedAt: state.blackDisconnectedAt,
      disconnectGraceMs: DISCONNECT_GRACE_MS,
      result: state.outcome?.result,
      reason: state.outcome?.reason,
    },
  };
}
