import { z } from "zod";

const cursorRecord = z.strictObject({ endedAt: z.iso.datetime(), id: z.uuid() });
const cursor = z.string().max(256).regex(/^[A-Za-z0-9_-]+$/).transform((value, ctx) => {
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error("Invalid cursor");
    const parsed = cursorRecord.parse(JSON.parse(decoded.toString("utf8")));
    if (new Date(parsed.endedAt).toISOString() !== parsed.endedAt) throw new Error("Invalid date");
    return { id: parsed.id, endedAt: new Date(parsed.endedAt) };
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid history cursor" });
    return z.NEVER;
  }
});
const integer = z.string().regex(/^(0|[1-9]\d{0,4})$/).transform(Number);
export const gameParamsSchema = z.strictObject({ id: z.uuid() });
export const emptyGameQuerySchema = z.strictObject({});
export const gameHistoryQuerySchema = z.strictObject({
  limit: integer.pipe(z.number().int().min(1).max(100)).default(20),
  cursor: cursor.optional(),
});
export const gameFenQuerySchema = z.strictObject({
  ply: integer.pipe(z.number().int().max(10000)).optional(),
});
