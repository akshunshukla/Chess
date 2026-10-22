import { redis } from "../db/index.ts";
import { serverNow } from "./game.clock.ts";
import { gameIndexes } from "./game.store.ts";

export interface TimerHooks {
  run(id: string, at: number): Promise<void>;
  sync(id: string, at: number): Promise<void>;
  maintain?(): Promise<void>;
}

export class TimerManager {
  private interval?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;
  private maintenance?: Promise<void>;
  private synchronization?: Promise<void>;
  private syncAt = 0;
  private dueCursor = 0;
  private syncCursor = 0;
  private lastErrorAt = 0;

  constructor(private readonly hooks: TimerHooks) {}

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.dispatch(), 100);
    this.interval.unref();
    this.dispatch();
  }

  pause(): void { clearInterval(this.interval); this.interval = undefined; }
  async stop(): Promise<void> {
    this.pause();
    await Promise.all([this.inFlight, this.synchronization, this.maintenance]);
  }

  private dispatch(): void {
    if (redis.status !== "ready") return;
    const now = serverNow();
    if (now >= this.syncAt) {
      this.syncAt = now + 1000;
      if (!this.synchronization) {
        this.synchronization = this.sync().catch((error) => this.report(error))
          .finally(() => { this.synchronization = undefined; });
      }
      if (this.hooks.maintain && !this.maintenance) {
        this.maintenance = this.hooks.maintain().catch((error) => this.report(error))
          .finally(() => { this.maintenance = undefined; });
      }
    }
    if (this.inFlight) return;
    this.inFlight = this.tick().catch((error) => this.report(error)).finally(() => { this.inFlight = undefined; });
  }

  private report(error: unknown): void {
    const now = serverNow();
    if (now - this.lastErrorAt < 5000) return;
    this.lastErrorAt = now;
    console.error("Game timer worker failed", error);
  }

  private async each(ids: string[], callback: (id: string, at: number) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try { await callback(id, serverNow()); } catch (error) { this.report(error); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
  }

  private async tick(): Promise<void> {
    if (redis.status !== "ready") return;
    const now = serverNow();
    const due = await redis.zcount(gameIndexes.deadlines, "-inf", now);
    if (due) {
      const offset = this.dueCursor % due;
      const ids = await redis.zrangebyscore(gameIndexes.deadlines, "-inf", now, "LIMIT", offset, 32);
      this.dueCursor = (offset + 32) % due;
      await this.each(ids, (id, at) => this.hooks.run(id, at));
    }
  }

  private async sync(): Promise<void> {
    const count = await redis.zcard(gameIndexes.deadlines);
    if (!count) { this.syncCursor = 0; return; }
    this.syncCursor %= count;
    const until = serverNow() + 900;
    let remaining = count;
    while (remaining > 0 && serverNow() < until) {
      const take = Math.min(32, remaining, count - this.syncCursor);
      const batch = await redis.zrange(gameIndexes.deadlines, String(this.syncCursor), String(this.syncCursor + take - 1));
      if (!batch.length) { this.syncCursor = 0; break; }
      this.syncCursor = (this.syncCursor + batch.length) % count;
      remaining -= batch.length;
      await this.each(batch, (id, at) => this.hooks.sync(id, at));
    }
  }
}
