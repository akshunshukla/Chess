import { z } from "zod";
import { gameMessageSchemas } from "./game.protocol.ts";
export const clientMessageSchema = z.discriminatedUnion("type", [
  ...gameMessageSchemas,
  z.strictObject({
    type: z.literal("auth"),
    payload: z.strictObject({ token: z.string().min(1).max(2048) }),
  }),
  z.strictObject({
    type: z.literal("queue:join"),
    payload: z.strictObject({
      timeControl: z.literal(600),
      increment: z.literal(0),
    }),
  }),
  z.strictObject({
    type: z.literal("queue:leave"),
    payload: z.strictObject({}),
  }),
]);
