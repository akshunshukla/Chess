import type { RequestHandler } from "express";
import { getUserProfile, loginUser, logoutUser, refreshUser, registerUser } from "../../auth/index.ts";
import { loginSchema, refreshSchema, registerSchema } from "../validation/auth.validation.ts";
import { HttpError } from "../../utils/errors.ts";
import { Prisma } from "../../generated/prisma/client.ts";

export const getMe: RequestHandler = async (_req, res, next) => {
  try {
    const user = await getUserProfile(res.locals.userId);
    if (!user) throw new HttpError(401, "Unauthorised");
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

export const register: RequestHandler = async (req, res, next) => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    next(new HttpError(400, "Invalid registration input"));
    return;
  }
  try {
    const user = await registerUser(result.data);
    res.status(201).json({ user });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      next(new HttpError(409, "Username or email already in use"));
      return;
    }
    next(error);
  }
};

export const login: RequestHandler = async (req, res, next) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    next(new HttpError(400, "Invalid login input"));
    return;
  }
  try {
    res.json(await loginUser(result.data));
  } catch (error) {
    next(error);
  }
};

export const refresh: RequestHandler = async (req, res, next) => {
  const result = refreshSchema.safeParse(req.body);
  if (!result.success) {
    next(new HttpError(400, "Invalid refresh input"));
    return;
  }
  try {
    res.json(await refreshUser(result.data.refreshToken));
  } catch (error) {
    next(error);
  }
};

export const logout: RequestHandler = async (req, res, next) => {
  const result = refreshSchema.safeParse(req.body);
  if (!result.success) {
    next(new HttpError(400, "Invalid logout input"));
    return;
  }
  try {
    await logoutUser(result.data.refreshToken);
    res.sendStatus(204);
  } catch (error) { next(error); }
};
