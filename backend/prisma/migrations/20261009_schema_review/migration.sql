-- Upgrade the confirmed-empty application tables after the 0_init baseline.
-- Keep schema changes and validation checks in one transaction.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path = public;

-- Hold the tables while checking emptiness and changing their definitions.
LOCK TABLE "User", "Game", "Move", "GameSnapshot", "GameAnalysis", "MoveAnalysis", "StudyPlan"
    IN ACCESS EXCLUSIVE MODE;

DO $migration$
BEGIN
    IF EXISTS (SELECT 1 FROM "User")
        OR EXISTS (SELECT 1 FROM "Game")
        OR EXISTS (SELECT 1 FROM "Move")
        OR EXISTS (SELECT 1 FROM "GameSnapshot")
        OR EXISTS (SELECT 1 FROM "GameAnalysis")
        OR EXISTS (SELECT 1 FROM "MoveAnalysis")
        OR EXISTS (SELECT 1 FROM "StudyPlan") THEN
        RAISE EXCEPTION 'This schema upgrade requires empty application tables; existing data needs a backfill migration.';
    END IF;
END;
$migration$;

-- CreateEnum
CREATE TYPE "Color" AS ENUM ('w', 'b');

-- CreateEnum
CREATE TYPE "AnalysisInputKind" AS ENUM ('pgn', 'fen');

-- DropIndex
DROP INDEX "Game_blackPlayerId_idx";

-- DropIndex
DROP INDEX "Game_whitePlayerId_idx";

-- DropIndex
DROP INDEX "GameSnapshot_gameId_moveCount_idx";

-- DropIndex
DROP INDEX "Move_gameId_moveNumber_color_idx";

-- DropIndex
DROP INDEX "MoveAnalysis_gameAnalysisId_moveNumber_idx";

-- DropIndex
DROP INDEX "StudyPlan_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "Game" ALTER COLUMN "timeControl" SET DEFAULT 600,
ALTER COLUMN "finalFen" SET DATA TYPE TEXT,
ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "endedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "GameAnalysis" DROP COLUMN "bestCount",
DROP COLUMN "blunderCount",
DROP COLUMN "brilliantCount",
DROP COLUMN "excellentCount",
DROP COLUMN "goodCount",
DROP COLUMN "inaccuracyCount",
DROP COLUMN "mistakeCount",
ADD COLUMN     "analysisInputId" UUID,
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blackBestCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blackBlunderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blackBrilliantCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blackExcellentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blackGoodCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blackInaccuracyCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blackMistakeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "classificationVersion" TEXT NOT NULL DEFAULT 'review-v1',
ADD COLUMN     "engineVersion" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "whiteBestCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whiteBlunderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whiteBrilliantCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whiteExcellentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whiteGoodCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whiteInaccuracyCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whiteMistakeCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "gameId" DROP NOT NULL,
ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "completedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "GameSnapshot" ALTER COLUMN "fen" SET DATA TYPE TEXT,
ALTER COLUMN "turn" TYPE "Color" USING "turn"::text::"Color",
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Move" ALTER COLUMN "color" TYPE "Color" USING "color"::text::"Color",
ALTER COLUMN "fenAfter" SET DATA TYPE TEXT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "MoveAnalysis" DROP COLUMN "winProbAfter",
DROP COLUMN "winProbBefore",
ADD COLUMN     "expectedScoreAfter" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "expectedScoreBefore" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "expectedScoreWithoutSacrifice" DOUBLE PRECISION,
ADD COLUMN     "mateAfter" INTEGER,
ADD COLUMN     "mateBefore" INTEGER,
ADD COLUMN     "sacrificeValue" INTEGER,
ADD COLUMN     "sacrificeVerified" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "color" TYPE "Color" USING "color"::text::"Color",
ALTER COLUMN "fenBefore" SET DATA TYPE TEXT,
ALTER COLUMN "fenAfter" SET DATA TYPE TEXT,
ALTER COLUMN "evalBeforeCp" DROP NOT NULL,
ALTER COLUMN "evalAfterCp" DROP NOT NULL,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "StudyPlan" ADD COLUMN     "completedAt" TIMESTAMPTZ(3),
ADD COLUMN     "gamesSelected" INTEGER NOT NULL,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "requestedAt" TIMESTAMPTZ(3) NOT NULL,
ALTER COLUMN "gamesAnalyzed" SET DEFAULT 0,
ALTER COLUMN "dateRangeStart" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "dateRangeEnd" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "inputSummary" DROP NOT NULL,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "User" DROP COLUMN "ratingDeviation",
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "AnalysisInput" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "kind" "AnalysisInputKind" NOT NULL,
    "pgn" TEXT,
    "startingFen" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionAnalysis" (
    "id" UUID NOT NULL,
    "gameAnalysisId" UUID NOT NULL,
    "fen" TEXT NOT NULL,
    "evalCp" INTEGER,
    "mateIn" INTEGER,
    "expectedScoreWhite" DOUBLE PRECISION NOT NULL,
    "bestMoveUci" VARCHAR(10),
    "bestMoveSan" VARCHAR(10),
    "engineLine" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyPlanGame" (
    "studyPlanId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "playerColor" "Color" NOT NULL,
    "gameAnalysisId" UUID,

    CONSTRAINT "StudyPlanGame_pkey" PRIMARY KEY ("studyPlanId","gameId")
);

-- CreateIndex
CREATE INDEX "AnalysisInput_ownerId_createdAt_idx" ON "AnalysisInput"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PositionAnalysis_gameAnalysisId_key" ON "PositionAnalysis"("gameAnalysisId");

-- CreateIndex
CREATE INDEX "StudyPlanGame_gameId_idx" ON "StudyPlanGame"("gameId");

-- CreateIndex
CREATE INDEX "StudyPlanGame_gameAnalysisId_idx" ON "StudyPlanGame"("gameAnalysisId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPlanGame_studyPlanId_position_key" ON "StudyPlanGame"("studyPlanId", "position");

-- CreateIndex
CREATE INDEX "Game_whitePlayerId_status_endedAt_id_idx" ON "Game"("whitePlayerId", "status", "endedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Game_blackPlayerId_status_endedAt_id_idx" ON "Game"("blackPlayerId", "status", "endedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "GameAnalysis_requestedBy_status_completedAt_idx" ON "GameAnalysis"("requestedBy", "status", "completedAt" DESC);

-- CreateIndex
CREATE INDEX "GameAnalysis_status_startedAt_idx" ON "GameAnalysis"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameAnalysis_analysisInputId_requestedBy_key" ON "GameAnalysis"("analysisInputId", "requestedBy");

-- CreateIndex
CREATE UNIQUE INDEX "GameSnapshot_gameId_moveCount_key" ON "GameSnapshot"("gameId", "moveCount");

-- CreateIndex
CREATE UNIQUE INDEX "Move_gameId_moveNumber_color_key" ON "Move"("gameId", "moveNumber", "color");

-- PostgreSQL retains and rebuilds the existing MoveAnalysis unique index
-- when its color column changes type.

-- CreateIndex
CREATE INDEX "StudyPlan_userId_requestedAt_idx" ON "StudyPlan"("userId", "requestedAt" DESC);

-- AddForeignKey
ALTER TABLE "AnalysisInput" ADD CONSTRAINT "AnalysisInput_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAnalysis" ADD CONSTRAINT "GameAnalysis_analysisInputId_fkey" FOREIGN KEY ("analysisInputId") REFERENCES "AnalysisInput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionAnalysis" ADD CONSTRAINT "PositionAnalysis_gameAnalysisId_fkey" FOREIGN KEY ("gameAnalysisId") REFERENCES "GameAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlanGame" ADD CONSTRAINT "StudyPlanGame_studyPlanId_fkey" FOREIGN KEY ("studyPlanId") REFERENCES "StudyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlanGame" ADD CONSTRAINT "StudyPlanGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlanGame" ADD CONSTRAINT "StudyPlanGame_gameAnalysisId_fkey" FOREIGN KEY ("gameAnalysisId") REFERENCES "GameAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row validation rules from schema-constraints.sql.
ALTER TABLE "User" ADD CONSTRAINT "User_game_counters_nonnegative"
  CHECK ("gamesPlayed" >= 0 AND "gamesWon" >= 0 AND "gamesDrawn" >= 0 AND "gamesLost" >= 0);

ALTER TABLE "Game" ADD CONSTRAINT "Game_distinct_players"
  CHECK ("whitePlayerId" <> "blackPlayerId");
ALTER TABLE "Game" ADD CONSTRAINT "Game_valid_time_control"
  CHECK ("timeControl" > 0 AND "increment" >= 0);
ALTER TABLE "Game" ADD CONSTRAINT "Game_valid_lifecycle"
  CHECK (
    (status IN ('waiting', 'active') AND result IS NULL AND "endedAt" IS NULL)
    OR (status = 'completed' AND result IS NOT NULL AND "resultReason" IS NOT NULL AND "endedAt" IS NOT NULL)
    OR (status = 'aborted' AND result IS NULL AND "resultReason" IS NOT NULL AND "endedAt" IS NOT NULL)
  );
ALTER TABLE "Game" ADD CONSTRAINT "Game_valid_event_order"
  CHECK ("endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt");

ALTER TABLE "Move" ADD CONSTRAINT "Move_valid_number_and_clock"
  CHECK ("moveNumber" > 0 AND "timeRemainingMs" >= 0);
ALTER TABLE "GameSnapshot" ADD CONSTRAINT "GameSnapshot_valid_checkpoint"
  CHECK ("moveCount" >= 0 AND "whiteTimeMs" >= 0 AND "blackTimeMs" >= 0);

ALTER TABLE "AnalysisInput" ADD CONSTRAINT "AnalysisInput_valid_payload"
  CHECK (btrim("startingFen") <> '' AND (
    (kind = 'pgn' AND pgn IS NOT NULL AND btrim(pgn) <> '')
    OR (kind = 'fen' AND pgn IS NULL)
  ));

ALTER TABLE "GameAnalysis" ADD CONSTRAINT "GameAnalysis_exactly_one_source"
  CHECK (("gameId" IS NULL) <> ("analysisInputId" IS NULL));
ALTER TABLE "GameAnalysis" ADD CONSTRAINT "GameAnalysis_valid_engine_settings"
  CHECK ("engineDepth" > 0 AND "attemptCount" BETWEEN 0 AND 3);
ALTER TABLE "GameAnalysis" ADD CONSTRAINT "GameAnalysis_valid_accuracy"
  CHECK (("accuracyWhite" IS NULL OR "accuracyWhite" BETWEEN 0 AND 100)
    AND ("accuracyBlack" IS NULL OR "accuracyBlack" BETWEEN 0 AND 100));
ALTER TABLE "GameAnalysis" ADD CONSTRAINT "GameAnalysis_counts_nonnegative"
  CHECK (
    "whiteBrilliantCount" >= 0 AND "whiteBestCount" >= 0 AND "whiteExcellentCount" >= 0
    AND "whiteGoodCount" >= 0 AND "whiteInaccuracyCount" >= 0
    AND "whiteMistakeCount" >= 0 AND "whiteBlunderCount" >= 0
    AND "blackBrilliantCount" >= 0 AND "blackBestCount" >= 0 AND "blackExcellentCount" >= 0
    AND "blackGoodCount" >= 0 AND "blackInaccuracyCount" >= 0
    AND "blackMistakeCount" >= 0 AND "blackBlunderCount" >= 0
  );
ALTER TABLE "GameAnalysis" ADD CONSTRAINT "GameAnalysis_completed_timestamp"
  CHECK (status <> 'completed' OR "completedAt" IS NOT NULL);

ALTER TABLE "MoveAnalysis" ADD CONSTRAINT "MoveAnalysis_score_representations"
  CHECK (("evalBeforeCp" IS NULL) <> ("mateBefore" IS NULL)
    AND ("evalAfterCp" IS NULL) <> ("mateAfter" IS NULL));
ALTER TABLE "MoveAnalysis" ADD CONSTRAINT "MoveAnalysis_valid_expected_scores"
  CHECK ("expectedScoreBefore" BETWEEN 0 AND 1 AND "expectedScoreAfter" BETWEEN 0 AND 1
    AND "expectedScoreLoss" BETWEEN 0 AND 1
    AND abs("expectedScoreLoss" - greatest(0, "expectedScoreBefore" - "expectedScoreAfter")) <= 0.000001);

ALTER TABLE "MoveAnalysis" ADD CONSTRAINT "MoveAnalysis_valid_sacrifice"
  CHECK (("sacrificeValue" IS NULL OR "sacrificeValue" >= 0)
    AND ("expectedScoreWithoutSacrifice" IS NULL OR "expectedScoreWithoutSacrifice" BETWEEN 0 AND 1)
    AND (NOT "sacrificeVerified" OR ("sacrificeValue" IS NOT NULL AND "sacrificeValue" >= 3
      AND "expectedScoreWithoutSacrifice" IS NOT NULL)));
ALTER TABLE "MoveAnalysis" ADD CONSTRAINT "MoveAnalysis_brilliant_requirements"
  CHECK (category <> 'brilliant' OR ("sacrificeVerified" AND "expectedScoreLoss" < 0.02
    AND "expectedScoreAfter" >= 0.5 AND "expectedScoreWithoutSacrifice" IS NOT NULL
    AND "expectedScoreWithoutSacrifice" < 0.9));
ALTER TABLE "MoveAnalysis" ADD CONSTRAINT "MoveAnalysis_valid_number"
  CHECK ("moveNumber" > 0);

ALTER TABLE "PositionAnalysis" ADD CONSTRAINT "PositionAnalysis_valid_evaluation"
  CHECK (("evalCp" IS NULL) <> ("mateIn" IS NULL));
ALTER TABLE "PositionAnalysis" ADD CONSTRAINT "PositionAnalysis_valid_expected_score"
  CHECK ("expectedScoreWhite" BETWEEN 0 AND 1);
ALTER TABLE "PositionAnalysis" ADD CONSTRAINT "PositionAnalysis_paired_best_move"
  CHECK (("bestMoveUci" IS NULL) = ("bestMoveSan" IS NULL));

ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_valid_game_counts"
  CHECK ("gamesSelected" BETWEEN 1 AND 20 AND "gamesAnalyzed" BETWEEN 0 AND "gamesSelected");
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_valid_request_window"
  CHECK ("dateRangeStart" <= "dateRangeEnd" AND "dateRangeEnd" < "requestedAt");
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_completed_inputs"
  CHECK (status <> 'completed' OR ("gamesAnalyzed" = "gamesSelected"
    AND "inputSummary" IS NOT NULL AND "planContent" IS NOT NULL AND "completedAt" IS NOT NULL));
ALTER TABLE "StudyPlanGame" ADD CONSTRAINT "StudyPlanGame_valid_position"
  CHECK (position BETWEEN 1 AND 20);

COMMIT;
