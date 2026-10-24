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
  attemptCount: number;
  startedAt: Date;
}
export async function lockAnalysis(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "GameAnalysis" WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function claimAnalysis(depth: number): Promise<ClaimedAnalysis | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "GameAnalysis" WHERE status = 'pending' AND "attemptCount" < 3
      ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows.length) return null;
    const id = rows[0].id;
    await tx.moveAnalysis.deleteMany({ where: { gameAnalysisId: id } });
    await tx.positionAnalysis.deleteMany({ where: { gameAnalysisId: id } });
    const job = await tx.gameAnalysis.update({ where: { id }, data: {
      ...emptySummary(), status: "processing", startedAt: new Date(), completedAt: null,
      lastError: null, engineVersion: null, engineDepth: depth,
      classificationVersion: REVIEW_VERSION, attemptCount: { increment: 1 },
    }, select: { id: true, attemptCount: true, startedAt: true } });
    return { ...job, startedAt: job.startedAt! };
  }, transactionOptions);
}

function ownership(job: ClaimedAnalysis) {
  return { id: job.id, status: "processing" as const,
    attemptCount: job.attemptCount, startedAt: job.startedAt };
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

export async function completeAnalysis(job: ClaimedAnalysis, result: AnalysisReviewResult, settings: string) {
  return prisma.$transaction(async (tx) => {
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
    await tx.gameAnalysis.update({ where: { id: job.id }, data: {
      ...summary, ...counts, accuracyWhite: result.accuracyWhite, accuracyBlack: result.accuracyBlack,
      engineVersion: `${result.engineVersion}; ${settings}`, status: "completed",
      completedAt: new Date(), lastError: null,
    } });
    return true;
  }, transactionOptions);
}

export async function releaseAnalysis(job: ClaimedAnalysis, message: string, permanent = false) {
  await prisma.gameAnalysis.updateMany({ where: ownership(job), data: {
    status: permanent || job.attemptCount >= 3 ? "failed" : "pending",
    startedAt: null, completedAt: null, lastError: message,
  } });
}

export async function recoverStaleAnalyses() {
  const stale = new Date(Date.now() - 10 * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.gameAnalysis.updateMany({ where: {
      status: "processing", OR: [{ startedAt: { lt: stale } }, { startedAt: null }],
      attemptCount: { lt: 3 },
    }, data: { status: "pending", startedAt: null, lastError: "Interrupted analysis will be retried" } });
    await tx.gameAnalysis.updateMany({ where: { attemptCount: { gte: 3 }, OR: [
      { status: "pending" }, { status: "processing", OR: [{ startedAt: { lt: stale } }, { startedAt: null }] },
    ] }, data: { status: "failed", startedAt: null, lastError: "Analysis attempt budget exhausted" } });
  }, transactionOptions);
}
