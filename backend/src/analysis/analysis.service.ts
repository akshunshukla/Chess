import { prisma } from "../db/index.ts";
import { HttpError } from "../utils/errors.ts";
import { analysisWorker } from "./AnalysisWorker.ts";
import { parseAnalysisInputAsync } from "./analysis.input.ts";
import { emptySummary, lockAnalysis } from "./analysis.jobs.ts";
import { stockfishConfig } from "./analysis.config.ts";
import { REVIEW_VERSION } from "./MoveCategorizer.ts";
import type { Prisma } from "../generated/prisma/client.ts";

const config = stockfishConfig();
const summary = { id: true, status: true, gameId: true, analysisInputId: true,
  attemptCount: true, createdAt: true, completedAt: true } as const;
const transactionOptions = { maxWait: 5000, timeout: 10000 };
async function admission(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`analysis:${userId}`}::text, 0))::text`;
  const pending = await tx.gameAnalysis.count({ where: {
    requestedBy: userId, status: { in: ["pending", "processing"] },
  } });
  if (pending >= 3) throw new HttpError(409, "You already have three unfinished analyses");
}
function submitted<T extends { status: string }>(analysis: T) {
  if (analysis.status === "pending") analysisWorker.wake();
  return { analysis };
}

export async function requestGameAnalysis(userId: string, gameId: string) {
  analysisWorker.assertAvailable();
  const game = await prisma.game.findFirst({ where: { id: gameId, OR: [
      { whitePlayerId: userId }, { blackPlayerId: userId },
  ] }, select: { status: true, pgn: true } });
  if (!game) throw new HttpError(404, "Game not found");
  if (game.status !== "completed" || !game.pgn) throw new HttpError(409, "A saved completed game is required");
  await parseAnalysisInputAsync({ kind: "pgn", pgn: game.pgn });
  const analysis = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`analysis:${userId}`}::text, 0))::text`;
    const existing = await tx.gameAnalysis.findUnique({ where: { gameId_requestedBy: { gameId, requestedBy: userId } }, select: summary });
    if (existing) return existing;
    await admission(tx, userId);
    return tx.gameAnalysis.create({ data: {
      gameId, requestedBy: userId, engineDepth: config.depth, classificationVersion: REVIEW_VERSION,
    }, select: summary });
  }, transactionOptions);
  return submitted(analysis);
}

export async function requestImportedAnalysis(userId: string, input: { kind: "pgn" | "fen"; pgn?: string; fen?: string }) {
  analysisWorker.assertAvailable();
  const parsed = await parseAnalysisInputAsync(input);
  const analysis = await prisma.$transaction(async (tx) => {
    await admission(tx, userId);
    const source = await tx.analysisInput.create({ data: {
      ownerId: userId, kind: parsed.kind, pgn: parsed.pgn,
      startingFen: parsed.startingFen, metadata: parsed.metadata,
    }, select: { id: true } });
    return tx.gameAnalysis.create({ data: {
      analysisInputId: source.id, requestedBy: userId, engineDepth: config.depth,
      classificationVersion: REVIEW_VERSION,
    }, select: summary });
  }, transactionOptions);
  return submitted(analysis);
}

export async function retryAnalysis(userId: string, id: string) {
  analysisWorker.assertAvailable();
  const analysis = await prisma.$transaction(async (tx) => {
    await admission(tx, userId);
    await lockAnalysis(tx, id);
    const job = await tx.gameAnalysis.findFirst({ where: { id, requestedBy: userId }, select: { status: true } });
    if (!job) throw new HttpError(404, "Analysis not found");
    if (job.status !== "failed") throw new HttpError(409, "Only failed analyses can be retried");
    await tx.moveAnalysis.deleteMany({ where: { gameAnalysisId: id } });
    await tx.positionAnalysis.deleteMany({ where: { gameAnalysisId: id } });
    return tx.gameAnalysis.update({ where: { id }, data: {
      ...emptySummary(), status: "pending", startedAt: null, completedAt: null,
      lastError: null, engineVersion: null, engineDepth: config.depth, classificationVersion: REVIEW_VERSION,
    }, select: summary });
  }, transactionOptions);
  return submitted(analysis);
}

export async function getAnalysis(userId: string, id: string) {
  const analysis = await prisma.gameAnalysis.findFirst({ where: { id, requestedBy: userId }, include: {
    moveAnalyses: { orderBy: [{ moveNumber: "asc" }, { color: "asc" }] },
    positionAnalysis: true,
    analysisInput: { select: { kind: true, pgn: true, startingFen: true, metadata: true } },
    game: { select: { pgn: true } },
  } });
  if (!analysis) throw new HttpError(404, "Analysis not found");
  if (analysis.status !== "completed") {
    Object.assign(analysis, emptySummary());
    analysis.moveAnalyses = [];
    analysis.positionAnalysis = null;
  }
  return { analysis: { ...analysis, moveAnalyses: analysis.moveAnalyses.map((move, index) => ({
    ...move, ply: index + 1,
  })) } };
}
