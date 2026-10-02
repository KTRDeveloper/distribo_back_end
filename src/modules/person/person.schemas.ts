import { z } from 'zod';
import { phoneNumberSchema } from '../../shared/phone.js';

export type LookupQuery = { phone: string };

/** Validates the closed lookup query and normalizes its phone to E.164. */
export const lookupQuerySchema = z
  .object({
    phone: phoneNumberSchema,
  })
  .strict();

/** Documents the deliberately minimal person lookup response. */
export const personLookupResponseSchema = z
  .object({
    phone_number: z.string(),
    registered: z.boolean(),
    public_name: z.string().nullable(),
  })
  .strict();
