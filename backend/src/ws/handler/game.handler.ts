import { type GameManager, type GameCommand } from "../../game/index.ts";

export function handleGameCommand(
  games: GameManager,
  userId: string,
  connectionId: string,
  message: GameCommand,
  receivedAt: number,
) {
  return games.handle(userId, connectionId, message, receivedAt);
}
