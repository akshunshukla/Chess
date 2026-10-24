import { z } from "zod";

export const analysisParamsSchema = z.strictObject({ analysisId: z.uuid() });
export const analysisGameParamsSchema = z.strictObject({ gameId: z.uuid() });
export const emptyAnalysisQuerySchema = z.strictObject({});
export const emptyAnalysisBodySchema = z.strictObject({});
export const analysisImportSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pgn"), pgn: z.string().min(1).max(131072) }),
  z.strictObject({ kind: z.literal("fen"), fen: z.string().min(1).max(256) }),
]);
