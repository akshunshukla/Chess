import { randomBytes } from "node:crypto";
import type {
  LoginInput,
  RegisterInput,
} from "../api/validation/auth.validation.ts";
import { prisma } from "../db/index.ts";
import { hashPassword, verifyPassword } from "../utils/password.ts";
import {
  verifyAccessTokenClaims,
  verifyRefreshToken,
  type AccessTokenClaims,
} from "../utils/tokens.ts";
import { HttpError } from "../utils/errors.ts";
import {
  createSession,
  isSessionActive,
  revokeSession,
  rotateSession,
} from "./session.store.ts";
import { userSelect } from "./user.ts";

let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  return (dummyHash ??= hashPassword(randomBytes(32).toString("hex")).catch(
    (error) => {
      dummyHash = undefined;
      throw error;
    },
  ));
}

export async function registerUser(input: RegisterInput) {
  const passwordHash = await hashPassword(input.password);

  return prisma.user.create({
    data: {
      username: input.username,
      email: input.email,
      passwordHash: passwordHash,
      displayName: input.displayName,
    },
    select: userSelect,
  });
}

export async function getUserProfile(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: userSelect });
}

export async function loginUser(input: LoginInput) {
  const [record, fallbackHash] = await Promise.all([
    prisma.user.findUnique({
      where: { email: input.email },
      select: { ...userSelect, passwordHash: true },
    }),
    getDummyHash(),
  ]);
  const matches = await verifyPassword(
    record?.passwordHash ?? fallbackHash,
    input.password,
  );
  if (!record || !matches)
    throw new HttpError(401, "Invalid email or password");
  const { passwordHash: _passwordHash, ...user } = record;
  return { user, ...(await createSession(user.id)) };
}

function refreshClaims(token: string) {
  try {
    return verifyRefreshToken(token);
  } catch {
    throw new HttpError(401, "Unauthorised");
  }
}

export async function refreshUser(refreshToken: string) {
  const claims = refreshClaims(refreshToken);
  const user = await getUserProfile(claims.userId);
  if (!user) {
    await revokeSession(claims.sessionId);
    throw new HttpError(401, "Unauthorised");
  }
  return rotateSession(refreshToken, claims);
}

export async function logoutUser(refreshToken: string) {
  const claims = refreshClaims(refreshToken);
  await revokeSession(claims.sessionId);
}

export async function authenticateUser(accessToken: string) {
  let claims;
  try {
    claims = verifyAccessTokenClaims(accessToken);
  } catch {
    throw new HttpError(401, "Unauthorised");
  }
  await assertSessionActive(claims);
  return claims;
}

export async function assertSessionActive(
  claims: AccessTokenClaims,
): Promise<void> {
  const active = await isSessionActive(claims);
  if (!active || claims.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, "Session expired or revoked");
  }
}
