-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AnalysisStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "public"."GameResult" AS ENUM ('white_win', 'black_win', 'draw');

-- CreateEnum
CREATE TYPE "public"."GameStatus" AS ENUM ('waiting', 'active', 'completed', 'aborted');

-- CreateEnum
CREATE TYPE "public"."MoveCategory" AS ENUM ('brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'book', 'forced');

-- CreateEnum
CREATE TYPE "public"."ResultReason" AS ENUM ('checkmate', 'resignation', 'stalemate', 'timeout', 'server_crash', 'draw_agreement', 'insufficient_material', 'threefold_repetition', 'fifty_move_rule', 'abandonment');

-- CreateEnum
CREATE TYPE "public"."StudyPlanStatus" AS ENUM ('processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "public"."Game" (
    "id" UUID NOT NULL,
    "whitePlayerId" UUID NOT NULL,
    "blackPlayerId" UUID NOT NULL,
    "status" "public"."GameStatus" NOT NULL DEFAULT 'waiting',
    "result" "public"."GameResult",
    "resultReason" "public"."ResultReason",
    "timeControl" INTEGER NOT NULL,
    "increment" INTEGER NOT NULL DEFAULT 0,
    "pgn" TEXT,
    "finalFen" VARCHAR(100),
    "whiteRatingBefore" INTEGER,
    "whiteRatingAfter" INTEGER,
    "blackRatingBefore" INTEGER,
    "blackRatingAfter" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GameAnalysis" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "status" "public"."AnalysisStatus" NOT NULL DEFAULT 'pending',
    "engineDepth" INTEGER NOT NULL DEFAULT 20,
    "accuracyWhite" DOUBLE PRECISION,
    "accuracyBlack" DOUBLE PRECISION,
    "brilliantCount" INTEGER NOT NULL DEFAULT 0,
    "bestCount" INTEGER NOT NULL DEFAULT 0,
    "excellentCount" INTEGER NOT NULL DEFAULT 0,
    "goodCount" INTEGER NOT NULL DEFAULT 0,
    "inaccuracyCount" INTEGER NOT NULL DEFAULT 0,
    "mistakeCount" INTEGER NOT NULL DEFAULT 0,
    "blunderCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GameSnapshot" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "moveCount" INTEGER NOT NULL,
    "fen" VARCHAR(100) NOT NULL,
    "movesUci" TEXT NOT NULL,
    "whiteTimeMs" INTEGER NOT NULL,
    "blackTimeMs" INTEGER NOT NULL,
    "turn" CHAR(1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Move" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "moveNumber" INTEGER NOT NULL,
    "color" CHAR(1) NOT NULL,
    "san" VARCHAR(10) NOT NULL,
    "uci" VARCHAR(10) NOT NULL,
    "fenAfter" VARCHAR(100) NOT NULL,
    "timeRemainingMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Move_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MoveAnalysis" (
    "id" UUID NOT NULL,
    "gameAnalysisId" UUID NOT NULL,
    "moveNumber" INTEGER NOT NULL,
    "color" CHAR(1) NOT NULL,
    "san" VARCHAR(10) NOT NULL,
    "fenBefore" VARCHAR(100) NOT NULL,
    "fenAfter" VARCHAR(100) NOT NULL,
    "engineBestMove" VARCHAR(10) NOT NULL,
    "engineBestSan" VARCHAR(10) NOT NULL,
    "evalBeforeCp" INTEGER NOT NULL,
    "evalAfterCp" INTEGER NOT NULL,
    "engineLine" TEXT,
    "winProbBefore" DOUBLE PRECISION NOT NULL,
    "winProbAfter" DOUBLE PRECISION NOT NULL,
    "expectedScoreLoss" DOUBLE PRECISION NOT NULL,
    "materialDelta" INTEGER,
    "category" "public"."MoveCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StudyPlan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "public"."StudyPlanStatus" NOT NULL DEFAULT 'processing',
    "gamesAnalyzed" INTEGER NOT NULL,
    "dateRangeStart" TIMESTAMP(3) NOT NULL,
    "dateRangeEnd" TIMESTAMP(3) NOT NULL,
    "inputSummary" JSONB NOT NULL,
    "planContent" JSONB,
    "modelUsed" VARCHAR(50),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" UUID NOT NULL,
    "username" VARCHAR(30) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "displayName" VARCHAR(50),
    "rating" INTEGER NOT NULL DEFAULT 1200,
    "ratingDeviation" INTEGER NOT NULL DEFAULT 350,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,
    "gamesDrawn" INTEGER NOT NULL DEFAULT 0,
    "gamesLost" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Game_blackPlayerId_idx" ON "public"."Game"("blackPlayerId" ASC);

-- CreateIndex
CREATE INDEX "Game_createdAt_idx" ON "public"."Game"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "public"."Game"("status" ASC);

-- CreateIndex
CREATE INDEX "Game_whitePlayerId_idx" ON "public"."Game"("whitePlayerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "GameAnalysis_gameId_requestedBy_key" ON "public"."GameAnalysis"("gameId" ASC, "requestedBy" ASC);

-- CreateIndex
CREATE INDEX "GameSnapshot_gameId_moveCount_idx" ON "public"."GameSnapshot"("gameId" ASC, "moveCount" DESC);

-- CreateIndex
CREATE INDEX "Move_gameId_moveNumber_color_idx" ON "public"."Move"("gameId" ASC, "moveNumber" ASC, "color" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MoveAnalysis_gameAnalysisId_moveNumber_color_key" ON "public"."MoveAnalysis"("gameAnalysisId" ASC, "moveNumber" ASC, "color" ASC);

-- CreateIndex
CREATE INDEX "MoveAnalysis_gameAnalysisId_moveNumber_idx" ON "public"."MoveAnalysis"("gameAnalysisId" ASC, "moveNumber" ASC);

-- CreateIndex
CREATE INDEX "StudyPlan_userId_createdAt_idx" ON "public"."StudyPlan"("userId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE INDEX "User_rating_idx" ON "public"."User"("rating" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "public"."User"("username" ASC);

-- AddForeignKey
ALTER TABLE "public"."Game" ADD CONSTRAINT "Game_blackPlayerId_fkey" FOREIGN KEY ("blackPlayerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Game" ADD CONSTRAINT "Game_whitePlayerId_fkey" FOREIGN KEY ("whitePlayerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GameAnalysis" ADD CONSTRAINT "GameAnalysis_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GameAnalysis" ADD CONSTRAINT "GameAnalysis_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GameSnapshot" ADD CONSTRAINT "GameSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Move" ADD CONSTRAINT "Move_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MoveAnalysis" ADD CONSTRAINT "MoveAnalysis_gameAnalysisId_fkey" FOREIGN KEY ("gameAnalysisId") REFERENCES "public"."GameAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StudyPlan" ADD CONSTRAINT "StudyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

