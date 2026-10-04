import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { LABEL_MAX, TEXT_MAX } from '../../shared/limits.js';
import { paginationQuerySchema } from '../../shared/pagination.js';
import { phoneNumberSchema } from '../../shared/phone.js';

/**
 * Strict body of the add-customer gesture: exactly four writable fields (ASVS v5.0.0-15.3.3).
 * Credit limit, balance, status, author and supplier are never accepted: the server sets them
 * (CWE-915). The number is normalized to E.164 and landlines are refused.
 */
export const addCustomerSchema = z
  .object({
    id: uuidV7Schema,
    phone_number: phoneNumberSchema,
    customer_label: z.string().trim().min(1).max(LABEL_MAX).optional(),
    delivery_address: z.string().max(TEXT_MAX).optional(),
  })
  .strict();

export type AddCustomerInput = z.infer<typeof addCustomerSchema>;

/**
 * Strict query of the customer list: `limit`, `cursor`, a status filter and the counter filter.
 * `counter` accepts only the words `true` and `false`; any other field or value is a 400.
 */
export const listCustomersQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(['PENDING', 'ACTIVE', 'ENDED']).optional(),
    counter: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

/**
 * Path of one customer: the relationship id must be a UUIDv7, else 400. Not strict because the
 * merged route params also carry `organizationId`, which `loadActor` already validated.
 */
export const customerParamsSchema = z.object({ relationshipId: uuidV7Schema });

/**
 * Strict body of the supplier-side edit: three optional fields, at least one (ASVS
 * v5.0.0-15.3.3). `customer_label` is never null, so a counter cannot lose its label (C-06);
 * `delivery_address` and `supplier_notes` accept null to clear them. Credit limit, balance,
 * status, `supplier_label` and the parties are rejected as unknown keys (CWE-915).
 */
export const editCustomerSchema = z
  .object({
    customer_label: z.string().trim().min(1).max(LABEL_MAX).optional(),
    delivery_address: z.string().max(TEXT_MAX).nullable().optional(),
    supplier_notes: z.string().max(TEXT_MAX).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

export type EditCustomerInput = z.infer<typeof editCustomerSchema>;
