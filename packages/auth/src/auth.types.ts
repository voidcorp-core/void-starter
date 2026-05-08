import { z } from 'zod';

export const roleSchema = z.enum(['user', 'admin']);
export type Role = z.infer<typeof roleSchema>;

export const sessionUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullable(),
  image: z.string().url().nullable(),
  role: roleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export type AuthSession = {
  user: SessionUser;
  expiresAt: Date;
};
