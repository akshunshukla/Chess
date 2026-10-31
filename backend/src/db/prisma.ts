import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { env } from "../config/env.ts";

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
  max: 5,
});

export const prisma = new PrismaClient({ adapter });
