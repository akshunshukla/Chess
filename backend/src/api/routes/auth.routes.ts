import { json, Router } from "express";
import { authenticate } from "../middleware/authenticate.ts";
import { getMe, login, logout, refresh, register } from "../controllers/auth.controller.ts";
import { rateLimiter } from "../middleware/rateLimiter.ts";

export const authRouter = Router();
authRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
authRouter.use(json({ limit: "16kb" }));
const AUTH_REQUESTS_PER_MINUTE = 10;
const authQuota = rateLimiter("auth", AUTH_REQUESTS_PER_MINUTE);
authRouter.post("/register", authQuota, register);
authRouter.post("/login", authQuota, login);
authRouter.post("/refresh", authQuota, refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", authenticate, getMe);
