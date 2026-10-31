-- Reference copy of checks included in migrations/20261009_schema_review/migration.sql.
-- Apply them through Prisma migrations so each database receives them once.
-- Future changes to installed checks belong in a new migration.

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
