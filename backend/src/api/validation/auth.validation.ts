import { z } from "zod";

export const registerSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/),
  email: z.string().trim().toLowerCase().max(255).pipe(z.email()),
  password: z.string().min(15).max(128),
  displayName: z.string().trim().min(1).max(50).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.strictObject({
  email: registerSchema.shape.email,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.strictObject({
  refreshToken: z.string().min(1).max(2048),
});

export type LoginInput = z.infer<typeof loginSchema>;
