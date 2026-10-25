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
 * Strict query of an organization's supplier list: `limit`, `cursor` and a status filter; any
 * other field or value is a 400.
 */
export const listSuppliersQuerySchema = paginationQuerySchema
  .extend({ status: z.enum(['PENDING', 'ACTIVE', 'ENDED']).optional() })
  .strict();

export type ListOrganizationSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

/**
 * Strict query of the signed-in person's supplier list: the same fields plus `contested`
 * (`true` | `false`, default `false`). Without it the contested records are hidden; `true` lists
 * only them (CM-24, C-57). Any other value is a 400.
 */
export const listMySuppliersQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(['PENDING', 'ACTIVE', 'ENDED']).optional(),
    contested: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strict();

export type ListSuppliersQuery = z.infer<typeof listMySuppliersQuerySchema>;

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

/**
 * Strict body of the add-counter gesture: exactly two writable fields (ASVS v5.0.0-15.3.3).
 * The credit limit (always 0 for a counter, C-10), status, author and organization are set by
 * the server and rejected as unknown keys (CWE-915).
 */
export const addCounterSchema = z
  .object({
    id: uuidV7Schema,
    customer_label: z.string().trim().min(1).max(LABEL_MAX),
  })
  .strict();

export type AddCounterInput = z.infer<typeof addCounterSchema>;

/**
 * Strict body of the set-credit-limit gesture: the gesture id and the limit (ASVS v5.0.0-15.3.3).
 * The limit is a whole number of XAF from 0 up, or null for no ceiling; it is required, so an
 * absent field is never read as "no ceiling". It stays within the safe integers so it always
 * fits the database column. Author and time are set by the server and rejected as unknown keys
 * (CWE-915).
 */
export const setCreditLimitSchema = z
  .object({
    id: uuidV7Schema,
    credit_limit: z.number().int().safe().min(0).nullable(),
  })
  .strict();

export type SetCreditLimitInput = z.infer<typeof setCreditLimitSchema>;

/** Strict query of the credit limit history: `limit` and `cursor` only; any other field is a 400. */
export const creditLimitChangesQuerySchema = paginationQuerySchema.strict();

/**
 * Strict body of the end and reopen gestures: only the gesture id (ASVS v5.0.0-15.3.3). Status and
 * `ended_by_party` are set by the server and rejected as unknown keys (CWE-915).
 */
export const endReopenSchema = z.object({ id: uuidV7Schema }).strict();

export type EndReopenInput = z.infer<typeof endReopenSchema>;

/**
 * Strict body of the customer-side rename: only `supplier_label`, 1 to 100 characters after
 * trimming (ASVS v5.0.0-15.3.3). `customer_label`, the credit limit and every other field are
 * rejected as unknown keys, so a customer writes only its own label (CM-19, CWE-915).
 */
export const editSupplierSchema = z
  .object({ supplier_label: z.string().trim().min(1).max(LABEL_MAX) })
  .strict();

export type EditSupplierInput = z.infer<typeof editSupplierSchema>;

/**
 * Strict body of the invite-supplier gesture: exactly three writable fields (ASVS v5.0.0-15.3.3).
 * The number is normalized to E.164 and landlines are refused. Status, credit limit, parties and
 * author are set by the server and rejected as unknown keys (CWE-915).
 */
export const inviteSupplierSchema = z
  .object({
    id: uuidV7Schema,
    phone_number: phoneNumberSchema,
    supplier_label: z.string().trim().min(1).max(LABEL_MAX),
  })
  .strict();

export type InviteSupplierInput = z.infer<typeof inviteSupplierSchema>;

/** Strict query of the invitation list: `limit` and `cursor` only; any other field is a 400. */
export const listInvitationsQuerySchema = paginationQuerySchema.strict();

export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;

/**
 * Path of one supplier invitation: the id must be a UUIDv7, else 400. The caller's own scope is
 * checked by the service, never taken from the path (ASVS v5.0.0-8.2.2).
 */
export const invitationParamsSchema = z.object({ invitationId: uuidV7Schema });

/**
 * Strict body of the accept gesture: the gesture id and the organization the caller answers for
 * (ASVS v5.0.0-15.3.3). Status, supplier columns and every other field are rejected as unknown
 * keys (CWE-915); the caller's right on the organization is checked by the service.
 */
export const acceptInvitationSchema = z
  .object({ id: uuidV7Schema, organization_id: uuidV7Schema })
  .strict();

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

/**
 * Strict body of the contest gesture: the gesture id and an optional reason, at most 2000
 * characters after trimming (ASVS v5.0.0-15.3.3). The reason is validated but not stored or
 * logged. The person and the mark are set by the server and rejected as unknown keys (CWE-915).
 */
export const contestSchema = z
  .object({
    id: uuidV7Schema,
    reason: z.string().trim().min(1).max(TEXT_MAX).optional(),
  })
  .strict();

export type ContestInput = z.infer<typeof contestSchema>;

/**
 * Strict body of the "this is me" gesture: only the gesture id. The mark is cleared by the server
 * (ASVS v5.0.0-15.3.3).
 */
export const uncontestSchema = z.object({ id: uuidV7Schema }).strict();

export type UncontestInput = z.infer<typeof uncontestSchema>;

/**
 * Strict body of the correct-number gesture: the gesture id, the right number (E.164, landlines
 * refused) and an optional reason (ASVS v5.0.0-15.3.3). `confirm_same_customer` is gone: it is an
 * unknown key, so a supplier cannot confirm a contested number. The previous person, the journal columns and the author are set by
 * the server and rejected as unknown keys (CWE-915).
 */
export const correctNumberSchema = z
  .object({
    id: uuidV7Schema,
    phone_number: phoneNumberSchema,
    reason: z.string().trim().min(1).max(TEXT_MAX).optional(),
  })
  .strict();

export type CorrectNumberInput = z.infer<typeof correctNumberSchema>;
