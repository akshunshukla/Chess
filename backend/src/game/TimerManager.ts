import { serverNow } from "./game.clock.ts";
import { DISCONNECT_GRACE_MS, type GameState } from "./game.types.ts";

export interface TimerHooks {
  run(id: string, armedForMoveCount: number): Promise<void>;
  abandon(id: string): Promise<void>;
  sync(id: string, at: number): Promise<void>;
  maintain(): Promise<void>;
}
interface ClockTimer { timer: ReturnType<typeof setTimeout>; armedForMoveCount: number }
interface GraceTimer { timer: ReturnType<typeof setTimeout>; deadline: number }

export class TimerManager {
  private readonly timers = new Map<string, ClockTimer>();
  private readonly graceTimers = new Map<string, GraceTimer>();
  private readonly pending = new Set<Promise<void>>();
  private interval?: ReturnType<typeof setInterval>;
  private tick?: Promise<void>;
  private running = false;

  constructor(private readonly hooks: TimerHooks) {}

  get activeCount(): number { return this.timers.size; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.interval = setInterval(() => {
      if (this.tick) return;
      this.tick = this.synchronize().catch(this.report).finally(() => { this.tick = undefined; });
    }, 1000);
    this.interval.unref();
  }

  arm(state: GameState): void {
    this.clearClock(state.id);
    if (!this.running || state.status !== "active") { this.clear(state.id); return; }
    const remaining = state.turn === "w" ? state.whiteTimeMs : state.blackTimeMs;
    const entry: ClockTimer = {
      armedForMoveCount: state.moveCount,
      timer: setTimeout(() => this.fireClock(state.id, entry), Math.max(1, state.lastMoveAt + remaining - serverNow())),
    };
    entry.timer.unref();
    this.timers.set(state.id, entry);
    this.armGrace(state);
  }

  private fireClock(id: string, entry: ClockTimer): void {
    if (!this.running || this.timers.get(id) !== entry) return;
    this.track(this.hooks.run(id, entry.armedForMoveCount).catch((error) => {
      this.report(error);
      if (this.running && this.timers.get(id) === entry) {
        entry.timer = setTimeout(() => this.fireClock(id, entry), 1000);
        entry.timer.unref();
      }
    }));
  }

  private armGrace(state: GameState): void {
    const dates = [state.whiteDisconnectedAt, state.blackDisconnectedAt]
      .filter((value): value is number => value !== undefined);
    const deadline = dates.length ? Math.min(...dates) + DISCONNECT_GRACE_MS : undefined;
    const previous = this.graceTimers.get(state.id);
    if (previous?.deadline === deadline) return;
    if (previous) clearTimeout(previous.timer);
    this.graceTimers.delete(state.id);
    if (deadline === undefined) return;
    const entry: GraceTimer = {
      deadline,
      timer: setTimeout(() => this.fireGrace(state.id, entry), Math.max(1, deadline - serverNow())),
    };
    entry.timer.unref();
    this.graceTimers.set(state.id, entry);
  }

  private fireGrace(id: string, entry: GraceTimer): void {
    if (!this.running || this.graceTimers.get(id) !== entry) return;
    this.graceTimers.delete(id);
    this.track(this.hooks.abandon(id).catch((error) => {
      this.report(error);
      if (this.running && !this.graceTimers.has(id) && this.timers.has(id)) {
        entry.timer = setTimeout(() => this.fireGrace(id, entry), 1000);
        entry.timer.unref();
        this.graceTimers.set(id, entry);
      }
    }));
  }

  private async synchronize(): Promise<void> {
    await Promise.all([...this.timers.keys()].map(async (id) => {
      try { await this.hooks.sync(id, serverNow()); } catch (error) { this.report(error); }
    }));
    if (this.running) await this.hooks.maintain();
  }

  private track(task: Promise<void>): void {
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }
  private report = (error: unknown): void => { console.error("Game timer failed:", error); };
  private clearClock(id: string): void {
    clearTimeout(this.timers.get(id)?.timer);
    this.timers.delete(id);
  }
  clear(id: string): void {
    this.clearClock(id);
    clearTimeout(this.graceTimers.get(id)?.timer);
    this.graceTimers.delete(id);
  }
  pause(): void {
    this.running = false;
    clearInterval(this.interval);
    this.interval = undefined;
    for (const id of this.timers.keys()) this.clear(id);
    for (const entry of this.graceTimers.values()) clearTimeout(entry.timer);
    this.graceTimers.clear();
  }
  async stop(): Promise<void> {
    this.pause();
    await this.tick;
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
