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

/**
 * `X-Scope-Version`: the rights version the phone knows, a non-negative integer of at most 9 digits
 * (ASVS v5.0.0-2.2.1). Absent means 0, so a phone that does not say what it knows is asked to start
 * again rather than trusted. The value is only compared, never stored (ASVS v5.0.0-8.2.2).
 */
export const scopeVersionHeaderSchema = z
  .string()
  .regex(/^\d{1,9}$/, 'Expected a non-negative integer')
  .optional()
  .transform((value) => (value === undefined ? 0 : Number(value)));
