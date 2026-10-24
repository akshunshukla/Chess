import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { getAnalysis, requestGameAnalysis, requestImportedAnalysis, retryAnalysis } from "../../analysis/index.ts";
import { HttpError } from "../../utils/errors.ts";
import {
  analysisGameParamsSchema, analysisImportSchema, analysisParamsSchema,
  emptyAnalysisBodySchema, emptyAnalysisQuerySchema,
} from "../validation/analysis.validation.ts";

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, "Invalid analysis request");
  return result.data;
}
export const submitGameAnalysis: RequestHandler = async (req, res, next) => {
  try {
    const { gameId } = parse(analysisGameParamsSchema, req.params);
    parse(emptyAnalysisQuerySchema, req.query);
    parse(emptyAnalysisBodySchema, req.body ?? {});
    const result = await requestGameAnalysis(res.locals.userId, gameId);
    res.location(`/api/analysis/${result.analysis.id}`).status(result.analysis.status === "completed" ? 200 : 202).json(result);
  } catch (error) { next(error); }
};
export const submitImportedAnalysis: RequestHandler = async (req, res, next) => {
  try {
    parse(emptyAnalysisQuerySchema, req.query);
    const input = parse(analysisImportSchema, req.body);
    const result = await requestImportedAnalysis(res.locals.userId, input);
    res.location(`/api/analysis/${result.analysis.id}`).status(202).json(result);
  } catch (error) { next(error); }
};
export const analysisStatus: RequestHandler = async (req, res, next) => {
  try {
    const { analysisId } = parse(analysisParamsSchema, req.params);
    parse(emptyAnalysisQuerySchema, req.query);
    res.json(await getAnalysis(res.locals.userId, analysisId));
  } catch (error) { next(error); }
};
export const retryFailedAnalysis: RequestHandler = async (req, res, next) => {
  try {
    const { analysisId } = parse(analysisParamsSchema, req.params);
    parse(emptyAnalysisQuerySchema, req.query);
    parse(emptyAnalysisBodySchema, req.body ?? {});
    const result = await retryAnalysis(res.locals.userId, analysisId);
    res.location(`/api/analysis/${result.analysis.id}`).status(202).json(result);
  } catch (error) { next(error); }
};
