import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.ts";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export interface RefreshTokenClaims extends AccessTokenClaims {
  expiresAt: number;
}

export function createAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ tokenType: "access", sid: sessionId }, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    subject: userId,
    issuer: "chess-backend",
    audience: "chess-api",
  });
}

function verifyClaims(token: string, tokenType: "access" | "refresh") {
  const secret = tokenType === "access"
    ? env.JWT_ACCESS_SECRET
    : env.JWT_REFRESH_SECRET;
  const payload = jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer: "chess-backend",
    audience: "chess-api",
  });
  if (
    typeof payload === "string" ||
    payload.tokenType !== tokenType ||
    typeof payload.sub !== "string" ||
    !uuid.test(payload.sub) ||
    typeof payload.sid !== "string" ||
    !uuid.test(payload.sid) ||
    typeof payload.exp !== "number" ||
    !Number.isSafeInteger(payload.exp) ||
    typeof payload.iat !== "number" ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > Math.floor(Date.now() / 1000) ||
    payload.exp <= payload.iat
  ) {
    throw new Error("Invalid token");
  }
  return {
    userId: payload.sub,
    sessionId: payload.sid,
    expiresAt: payload.exp,
    tokenId: payload.jti,
  };
}

export function verifyAccessTokenClaims(token: string): AccessTokenClaims {
  const { userId, sessionId } = verifyClaims(token, "access");
  return { userId, sessionId };
}

export function verifyAccessToken(token: string): string {
  return verifyAccessTokenClaims(token).userId;
}

export function createRefreshToken(
  userId: string,
  sessionId: string,
  expiresAt: number,
): string {
  return jwt.sign({ tokenType: "refresh", sid: sessionId, exp: expiresAt }, env.JWT_REFRESH_SECRET, {
    algorithm: "HS256",
    subject: userId,
    jwtid: randomUUID(),
    issuer: "chess-backend",
    audience: "chess-api",
  });
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const claims = verifyClaims(token, "refresh");
  if (typeof claims.tokenId !== "string" || !uuid.test(claims.tokenId)) {
    throw new Error("Invalid refresh token");
  }
  return {
    userId: claims.userId,
    sessionId: claims.sessionId,
    expiresAt: claims.expiresAt,
  };
}
