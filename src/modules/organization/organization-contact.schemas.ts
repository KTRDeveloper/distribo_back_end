import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';

/**
 * Strict body of the add-contact gesture: exactly four writable fields (ASVS v5.0.0-15.3.3).
 * `verified_at`, `verification_method` and `created_by_id` are never accepted: the server sets
 * them (C-44). Only a phone number is added here (the email has its own route). The `value` is
 * checked and normalized to E.164 in the service, so a number that is not a Cameroon mobile
 * answers UNSUPPORTED_NUMBER and not a generic validation error.
 */
export const addContactSchema = z
  .object({
    id: uuidV7Schema,
    kind: z.literal('PHONE'),
    slot: z.number().int().min(1).max(3),
    value: z.string().min(1).max(32),
  })
  .strict();

export type AddContactInput = z.infer<typeof addContactSchema>;

/** Closed response of a contact: explicit fields only (ASVS v5.0.0-15.3.1). */
export type ContactView = {
  id: string;
  kind: 'PHONE' | 'EMAIL';
  slot: number | null;
  value: string;
  verified_at: string | null;
  verification_method: 'CODE' | 'OWNER_PHONE' | null;
  created_at: string;
};
