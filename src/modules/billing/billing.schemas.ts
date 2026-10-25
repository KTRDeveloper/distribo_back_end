import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { phoneNumberSchema } from '../../shared/phone.js';

/** Same 32 symbols as `generatePaymentCode`: no 0, O, 1 or I. */
const PAYMENT_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

/**
 * Code typed on the payment site: trimmed and upper-cased, then exactly 8 symbols of the
 * payment alphabet. The raw length is capped first so a huge input is never processed.
 */
export const paymentCodeSchema = z
  .string()
  .max(64)
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.string().regex(PAYMENT_CODE_PATTERN));

const keepIdsSchema = z.array(z.string().uuid()).max(100).refine(
  (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
  { message: 'Ids must be distinct' }
);

/** Only these owner-chosen fields may enter the immutable KEEP_CHOICE details. */
export const keepChoiceBodySchema = z.object({
  id: uuidV7Schema,
  collaboration_ids: keepIdsSchema,
  product_ids: keepIdsSchema,
}).strict();

export const keepChoiceParamsSchema = z.object({ organizationId: uuidV7Schema }).strict();

export const keepChoiceResponseSchema = z.object({
  collaboration_ids: z.array(z.string().uuid()).max(100),
  product_ids: z.array(z.string().uuid()).max(100),
}).strict();

export const shopParamsSchema = z.object({ code: paymentCodeSchema }).strict();

/** Status accepts any UUID, but no query fields (ASVS 2.2.1). */
export const paymentStatusParamsSchema = z.object({ id: z.string().uuid() }).strict();
export const paymentStatusQuerySchema = z.object({}).strict();

/** The public receipt projection excludes internal ids and provider evidence. */
export const receiptViewSchema = z.object({
  number: z.string(),
  label: z.string(),
  customer_name: z.string(),
  customer_tax_id: z.string().nullable(),
  amount_excl_tax: z.number().int(),
  vat_rate_bp: z.number().int(),
  vat_amount: z.number().int(),
  amount: z.number().int(),
  issued_at: z.string().datetime(),
}).strict();

/** Explicit output fields for the public bearer-id status lookup. */
export const paymentStatusResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED']),
  business_name: z.string(),
  plan: z.enum(['ESSENTIAL', 'PRO', 'ENTERPRISE']),
  months: z.number().int(),
  amount: z.number().int(),
  operator: z.enum(['MTN_MOMO', 'ORANGE_MONEY', 'OTHER']),
  period: z.object({
    starts_at: z.string().datetime(), ends_at: z.string().datetime(),
  }).strict().nullable(),
  receipt: receiptViewSchema.nullable(),
}).strict();

/** Documents the shop answer: the name only (ASVS v5.0.0-15.3.1). */
export const shopResponseSchema = z.object({ name: z.string() }).strict();

/** Documents the raw `code` path parameter before cleaning. */
export const shopParamsOpenApiSchema = z.object({ code: z.string() });

/**
 * Body of a payment creation. Strict: every writable field is named and the amount is not one
 * of them, the server reads it from the price grid (ASVS v5.0.0-2.2.1, v5.0.0-2.2.3). The
 * phone goes through `normalizeE164` (mobile numbers only); a failure never echoes the input.
 */
export const createPaymentBodySchema = z
  .object({
    id: uuidV7Schema,
    code: paymentCodeSchema,
    plan: z.enum(['ESSENTIAL', 'PRO', 'ENTERPRISE']),
    months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    operator: z.enum(['MTN_MOMO', 'ORANGE_MONEY']),
    payer_phone_number: z.string().max(32).pipe(phoneNumberSchema),
    customer_tax_id: z
      .string()
      .regex(/^[A-Za-z0-9]{1,20}$/)
      .optional(),
    terms_version: z.string().min(1).max(20),
  })
  .strict();

/** Documents the raw body before cleaning. */
export const createPaymentBodyOpenApiSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    plan: z.enum(['ESSENTIAL', 'PRO', 'ENTERPRISE']),
    months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    operator: z.enum(['MTN_MOMO', 'ORANGE_MONEY']),
    payer_phone_number: z.string(),
    customer_tax_id: z.string().optional(),
    terms_version: z.string(),
  })
  .strict();

/** Documents the payment answer: six fields, no number or reference (ASVS v5.0.0-15.3.3). */
export const paymentResponseSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED']),
    plan: z.enum(['ESSENTIAL', 'PRO', 'ENTERPRISE']),
    months: z.number().int(),
    amount: z.number().int(),
    operator: z.enum(['MTN_MOMO', 'ORANGE_MONEY']),
  })
  .strict();
