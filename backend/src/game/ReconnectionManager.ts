import { timeoutResult } from "./ChessValidator.ts";
import { mutateGame } from "./game.store.ts";
import { DISCONNECT_GRACE_MS, type GameHooks, type GameState } from "./game.types.ts";

interface Absence { at: number; returnedAt?: number; retained: boolean }
interface PresenceEvent {
  userId: string;
  kind: "disconnect" | "reconnect" | "abandon";
  at: number;
  absence?: Absence;
}

export class ReconnectionManager {
  private readonly absences = new Map<string, Absence[]>();
  private readonly firstReturn = new Map<string, number>();

  constructor(private readonly hooks: Pick<GameHooks, "send" | "connectedAt">) {}

  disconnected(userId: string, at: number): void {
    if (this.hooks.connectedAt(userId) !== undefined) return;
    const gaps = this.absences.get(userId) ?? [];
    if (gaps.length && gaps[gaps.length - 1].returnedAt === undefined) return;
    if (gaps.some((gap) => gap.returnedAt !== undefined && gap.returnedAt > gap.at + DISCONNECT_GRACE_MS)) return;
    gaps.push({ at, retained: false });
    this.absences.set(userId, gaps);
  }

  connected(userId: string): void {
    const at = this.hooks.connectedAt(userId);
    if (at === undefined) return;
    if (!this.firstReturn.has(userId)) this.firstReturn.set(userId, at);
    const gaps = this.absences.get(userId);
    const gap = gaps?.[gaps.length - 1];
    if (!gap || gap.returnedAt !== undefined || at < gap.at) return;
    gap.returnedAt = at;
    // Unwritten timely gaps have no clock or result effect; retain uncertain Redis commits.
    if (!gap.retained && at <= gap.at + DISCONNECT_GRACE_MS) gaps!.pop();
    if (!gaps!.length) this.absences.delete(userId);
  }

  forget(userId: string): void { this.absences.delete(userId); this.firstReturn.delete(userId); }

  private players(state: GameState) {
    return [
      { userId: state.whiteId, disconnectedAt: state.whiteDisconnectedAt },
      { userId: state.blackId, disconnectedAt: state.blackDisconnectedAt },
    ];
  }

  private mutate(state: GameState, kind: "disconnect" | "reconnect" | "abandon", actorId: string, at: number) {
    return mutateGame(state, { kind, actorId, at, timeoutResult: timeoutResult(state) });
  }

  private events(state: GameState, at: number): PresenceEvent[] {
    const events: PresenceEvent[] = [];
    for (const { userId, disconnectedAt } of this.players(state)) {
      const connectedAt = this.hooks.connectedAt(userId);
      let gaps = this.absences.get(userId);
      while (gaps?.[0]?.returnedAt !== undefined && gaps[0].returnedAt! < state.startedAt) gaps.shift();
      if (!gaps?.length && disconnectedAt === undefined && connectedAt === undefined) {
        gaps = [{ at, retained: false }];
        this.absences.set(userId, gaps);
      }
      const gap = gaps?.[0];
      if (disconnectedAt === undefined) {
        if (gap) events.push({ userId, kind: "disconnect", at: Math.max(state.startedAt, gap.at), absence: gap });
        continue;
      }
      const matchingGap = gap && Math.max(state.startedAt, gap.at) === disconnectedAt ? gap : undefined;
      if (matchingGap) matchingGap.retained = true;
      events.push({ userId, kind: "abandon", at: disconnectedAt + DISCONNECT_GRACE_MS });
      const returns = [matchingGap?.returnedAt, this.firstReturn.get(userId), connectedAt]
        .filter((value): value is number => value !== undefined && value >= disconnectedAt);
      if (returns.length) events.push({ userId, kind: "reconnect", at: Math.min(...returns) });
    }
    return events;
  }

  private removeAbsence(userId: string, state: GameState): void {
    const marker = userId === state.whiteId ? state.whiteDisconnectedAt : state.blackDisconnectedAt;
    const gaps = this.absences.get(userId);
    if (gaps?.[0] && Math.max(state.startedAt, gaps[0].at) === marker) gaps.shift();
    if (!gaps?.length) this.absences.delete(userId);
  }

  private notify(state: GameState, event: PresenceEvent, at: number): void {
    const opponent = event.userId === state.whiteId ? state.blackId : state.whiteId;
    if (event.kind === "disconnect") {
      this.hooks.send(opponent, { type: "game:opponent:disconnected", payload: {
        gameId: state.id, gracePeriodMs: Math.max(0, event.at + DISCONNECT_GRACE_MS - at),
        deadline: event.at + DISCONNECT_GRACE_MS,
      } });
    } else if (event.kind === "reconnect") {
      this.hooks.send(opponent, { type: "game:opponent:reconnected", payload: { gameId: state.id } });
    }
  }

  async settle(state: GameState, at: number): Promise<GameState> {
    while (state.status === "active") {
      const rank = { reconnect: 0, disconnect: 1, abandon: 2 };
      const event = this.events(state, at).sort((a, b) => a.at - b.at ||
        rank[a.kind] - rank[b.kind] || a.userId.localeCompare(b.userId))[0];
      if (!event || event.at > at) break;
      // Protect this interval before awaiting Redis: the reply can be lost after a commit.
      if (event.absence) event.absence.retained = true;
      const previous = state;
      state = await this.mutate(state, event.kind, event.userId, event.at);
      if (event.kind === "reconnect") this.removeAbsence(event.userId, previous);
      if (state.status === "active") this.notify(state, event, at);
    }
    return state;
  }
}
