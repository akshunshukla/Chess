import { z } from "zod";

const gameId = z.uuid();
const square = z.string().regex(/^[a-h][1-8]$/);
export const gameMessageSchemas = [
  z.strictObject({
    type: z.literal("game:move"),
    payload: z.strictObject({
      gameId, from: square, to: square,
      promotion: z.enum(["q", "r", "b", "n"]).optional(),
      expectedPly: z.number().int().min(0).max(10000),
    }),
  }),
  z.strictObject({ type: z.literal("game:resign"), payload: z.strictObject({ gameId }) }),
  z.strictObject({ type: z.literal("game:draw:offer"), payload: z.strictObject({ gameId }) }),
  z.strictObject({
    type: z.literal("game:draw:respond"),
    payload: z.strictObject({ gameId, accept: z.boolean() }),
  }),
  z.strictObject({ type: z.literal("game:reconnect"), payload: z.strictObject({ gameId }) }),
] as const;
