import { GameError } from "./game.types.ts";

export class GameTasks {
  private readonly tasks = new Map<string, { tail: Promise<void>; count: number }>();

  run<T>(id: string, task: () => Promise<T>): Promise<T> {
    const entry = this.tasks.get(id) ?? { tail: Promise.resolve(), count: 0 };
    if (entry.count >= 64) return Promise.reject(new GameError("GAME_BUSY", "Too many pending game commands"));
    entry.count++;
    const result = entry.tail.then(task);
    entry.tail = result.then(() => {}, () => {});
    this.tasks.set(id, entry);
    void entry.tail.then(() => {
      entry.count--;
      if (!entry.count && this.tasks.get(id) === entry) this.tasks.delete(id);
    });
    return result;
  }

  async drain() {
    while (this.tasks.size) await Promise.all([...this.tasks.values()].map((entry) => entry.tail));
  }
}
