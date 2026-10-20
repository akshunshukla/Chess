import { joinQueue, leaveQueue } from "../../game/index.ts";

type QueueCommand = "queue:join" | "queue:leave";

export async function handleQueueCommand(
  userId: string,
  connectionId: string,
  command: QueueCommand,
  isCurrent: () => boolean = () => true,
) {
  const status =
    command === "queue:join"
      ? await joinQueue(userId, connectionId, isCurrent)
      : await leaveQueue(userId, connectionId);
  return {
    type: "queue:status",
    payload: { command, status },
  };
}

const queueTasks = new Map<string, Promise<void>>();

export function serializeQueueTask(
  userId: string,
  task: () => Promise<void>,
): Promise<void> {
  const previous = queueTasks.get(userId) ?? Promise.resolve();
  const result = previous.then(task);
  const settled = result.catch(() => {});
  queueTasks.set(userId, settled);

  void settled.then(() => {
    if (queueTasks.get(userId) === settled) queueTasks.delete(userId);
  });
  return result;
}

export async function drainQueueTasks(): Promise<void> {
  while (queueTasks.size) await Promise.all([...queueTasks.values()]);
}
