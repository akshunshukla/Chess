import { prisma } from "../db/index.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { REVIEW_VERSION } from "./MoveCategorizer.ts";
import { parseAnalysisInputAsync } from "./analysis.input.ts";
import type { AnalysisReviewResult } from "./AnalysisReviewer.ts";
import { HttpError } from "../utils/errors.ts";

const transactionOptions = { maxWait: 5000, timeout: 10000 };
const categories = ["brilliant", "best", "excellent", "good", "inaccuracy", "mistake", "blunder"] as const;
export function emptySummary() {
  const counters: Record<string, number> = {};
  for (const color of ["white", "black"]) for (const category of categories) {
    counters[`${color}${category[0].toUpperCase()}${category.slice(1)}Count`] = 0;
  }
  return { ...counters, accuracyWhite: null, accuracyBlack: null };
}
export interface ClaimedAnalysis {
  id: string;
  startedAt: Date;
}
export async function lockAnalysis(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "GameAnalysis" WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function claimAnalysis(depth: number): Promise<ClaimedAnalysis | null> {
  const rows = await prisma.$queryRaw<ClaimedAnalysis[]>`
    UPDATE "GameAnalysis"
    SET status = 'processing', "startedAt" = date_trunc('milliseconds', clock_timestamp()),
      "updatedAt" = NOW(), "completedAt" = NULL, "lastError" = NULL,
      "engineVersion" = NULL, "engineDepth" = ${depth}, "classificationVersion" = ${REVIEW_VERSION}
    WHERE id = (
      SELECT id FROM "GameAnalysis" WHERE status = 'pending'
      ORDER BY "createdAt", id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "startedAt"`;
  return rows[0] ?? null;
}

function ownership(job: ClaimedAnalysis) {
  return { id: job.id, status: "processing" as const,
    startedAt: job.startedAt };
}

export async function loadAnalysisSource(job: ClaimedAnalysis) {
  const record = await prisma.gameAnalysis.findFirst({ where: ownership(job), include: {
    game: { select: { pgn: true, status: true, whitePlayerId: true, blackPlayerId: true } },
    analysisInput: true,
  } });
  if (!record) throw new HttpError(409, "Analysis is no longer owned by this worker");
  if ((record.gameId === null) === (record.analysisInputId === null)) {
    throw new HttpError(400, "Analysis must have exactly one source");
  }
  if (record.game) {
    const game = record.game;
    if (![game.whitePlayerId, game.blackPlayerId].includes(record.requestedBy)) {
      throw new HttpError(400, "Analysis source is unavailable");
    }
    if (game.status !== "completed" || !game.pgn) throw new HttpError(400, "Game is not saved");
    return parseAnalysisInputAsync({ kind: "pgn", pgn: game.pgn });
  }
  const input = record.analysisInput;
  if (!input || input.ownerId !== record.requestedBy) throw new HttpError(400, "Analysis source is unavailable");
  const parsed = await parseAnalysisInputAsync(input.kind === "pgn"
    ? { kind: "pgn", pgn: input.pgn ?? undefined } : { kind: "fen", fen: input.startingFen });
  if (parsed.startingFen !== input.startingFen) throw new HttpError(400, "Analysis source changed");
  return parsed;
}

export async function completeAnalysis(
  job: ClaimedAnalysis, result: AnalysisReviewResult, settings: string, signal?: AbortSignal,
) {
  return prisma.$transaction(async (tx) => {
    signal?.throwIfAborted();
    await lockAnalysis(tx, job.id);
    if (!await tx.gameAnalysis.findFirst({ where: ownership(job), select: { id: true } })) return false;
    if (result.moves.length) await tx.moveAnalysis.createMany({ data: result.moves.map((move) => ({
      ...move, gameAnalysisId: job.id,
    })) });
    if (result.position) await tx.positionAnalysis.create({ data: { ...result.position, gameAnalysisId: job.id } });
    const summary = emptySummary();
    const counts: Record<string, number> = {};
    for (const move of result.moves) {
      if (move.category === "book" || move.category === "forced") continue;
      const key = `${move.color === "w" ? "white" : "black"}${move.category[0].toUpperCase()}${move.category.slice(1)}Count`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    signal?.throwIfAborted();
    await tx.gameAnalysis.update({ where: { id: job.id }, data: {
      ...summary, ...counts, accuracyWhite: result.accuracyWhite, accuracyBlack: result.accuracyBlack,
      engineVersion: `${result.engineVersion}; ${settings}`, status: "completed",
      completedAt: new Date(), lastError: null,
    } });
    signal?.throwIfAborted();
    return true;
  }, transactionOptions);
}

export async function failAnalysis(job: ClaimedAnalysis, message: string) {
  await prisma.gameAnalysis.updateMany({ where: ownership(job), data: {
    status: "failed",
    startedAt: null, completedAt: null, lastError: message,
  } });
}

export async function failInterruptedAnalyses() {
  const result = await prisma.gameAnalysis.updateMany({ where: { status: "processing" }, data: {
    status: "failed", startedAt: null, completedAt: null,
    lastError: "Interrupted by server restart",
  } });
  return result.count;
}
