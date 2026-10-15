import type { Prisma } from "../generated/prisma/client.ts";

export const userSelect = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  rating: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
