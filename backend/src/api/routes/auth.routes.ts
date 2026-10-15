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
authRouter.post("/register", rateLimiter("auth-register", 5), register);
authRouter.post("/login", rateLimiter("auth-login", 10), login);
authRouter.post("/refresh", rateLimiter("auth-refresh", 20), refresh);
authRouter.post("/logout", rateLimiter("auth-logout", 20), logout);
authRouter.get("/me", authenticate, rateLimiter("auth-me", 60, "user"), getMe);
