import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';

const addPhoneContactSchema = z
  .object({
    id: uuidV7Schema,
    kind: z.literal('PHONE'),
    slot: z.number().int().min(1).max(3),
    value: z.string().min(1).max(32),
  })
  .strict();

// An email has no `slot`: the strict object refuses one. The address is trimmed and lower-cased
// before the format and length checks, so `Shop@Example.cm` and `shop@example.cm` are one value.
const addEmailContactSchema = z
  .object({
    id: uuidV7Schema,
    kind: z.literal('EMAIL'),
    value: z.string().trim().toLowerCase().min(1).max(254).email(),
  })
  .strict();

/**
 * Strict body of the add-contact gesture: exactly the writable fields of its kind (ASVS
 * v5.0.0-15.3.3). A PHONE carries `id`, `kind`, `slot` and `value`; an EMAIL carries `id`, `kind`
 * and `value` (ORG-042). `verified_at`, `verification_method` and `created_by_id` are never
 * accepted: the server sets them (C-44). A phone `value` is checked and normalized to E.164 in the
 * service, so a number that is not a Cameroon mobile answers UNSUPPORTED_NUMBER and not a generic
 * validation error.
 */
export const addContactSchema = z.discriminatedUnion('kind', [
  addPhoneContactSchema,
  addEmailContactSchema,
]);

export type AddContactInput = z.infer<typeof addContactSchema>;

/**
 * Strict body of the confirm-contact gesture: the gesture id and the six-digit code, nothing
 * else. `verified_at` and `verification_method` are set by the server (C-44).
 */
export const confirmContactSchema = z
  .object({
    id: uuidV7Schema,
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

export type ConfirmContactInput = z.infer<typeof confirmContactSchema>;

/** Strict body of the resend-code gesture: the gesture id only. */
export const resendContactSchema = z.object({ id: uuidV7Schema }).strict();

/** Path parameters of the confirm-contact, resend-code and delete-contact routes. */
export const contactParamsSchema = z
  .object({ organizationId: uuidV7Schema, contactId: uuidV7Schema })
  .strict();

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
