import { z } from 'zod';

/**
 * Zod schemas for user module
 */

export const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
