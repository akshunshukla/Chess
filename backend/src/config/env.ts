import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const value = process.env[key];

  if (!value?.trim()) {
    throw new Error(`Missing required env variable : ${key}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || "development";
const accessSecret = required("JWT_ACCESS_SECRET");
const refreshSecret = required("JWT_REFRESH_SECRET");

const port = Number(process.env.PORT ?? "3000");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
export const env = {
  PORT: port,
  NODE_ENV: nodeEnv,
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: required("REDIS_URL"),
  JWT_ACCESS_SECRET: accessSecret,
  JWT_REFRESH_SECRET: refreshSecret,
};
