import type { RequestHandler } from "express";
import { authenticateUser } from "../../auth/index.ts";
import { HttpError } from "../../utils/errors.ts";

export const authenticate: RequestHandler = async (req, res, next) => {
  const match = req.get("Authorization")?.match(/^Bearer +(\S+)$/i);
  if (!match || match[1].length > 2048) {
    next(new HttpError(401, "Unauthorised"));
    return;
  }
  try {
    const claims = await authenticateUser(match[1]);
    res.locals.userId = claims.userId;
    res.locals.sessionId = claims.sessionId;
    next();
  } catch (error) {
    next(error);
  }
};
