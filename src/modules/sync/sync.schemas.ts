import { z } from 'zod';

/** Epoch milliseconds stay far below 16 digits; the cap bounds the input (ASVS v5.0.0-2.2.1). */
const EPOCH_MS_DIGITS = /^\d{1,15}$/;

/**
 * Strict query of the pull: only `last_pulled_at`, a non-negative epoch in milliseconds that is not
 * in the future, or empty/absent for a first pull. The result is the epoch as a number, or null.
 */
export const pullQuerySchema = z
  .object({
    last_pulled_at: z
      .string()
      .max(15)
      .refine((value) => value === '' || EPOCH_MS_DIGITS.test(value), 'Expected epoch milliseconds')
      .optional(),
  })
  .strict()
  .transform((query) =>
    query.last_pulled_at === undefined || query.last_pulled_at === ''
      ? null
      : Number(query.last_pulled_at)
  )
  .refine((value) => value === null || value <= Date.now(), 'last_pulled_at is in the future');

export type PullQuery = z.infer<typeof pullQuerySchema>;
