import { z } from 'zod';

/** Strictly limits self-service profile updates to client-owned fields. */
export const updateProfileSchema = z
  .object({
    full_name: z.string().min(1).max(100).optional(),
    preferred_language: z.enum(['FR', 'EN']).optional(),
    email: z.string().email().nullable().optional(),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
