import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { phoneNumberSchema } from '../../shared/phone.js';
import { decodeCursor, paginationQuerySchema } from '../../shared/pagination.js';

/** Refund identity comes only from validated path ids; the payment is the gesture key. */
export const refundPaymentParamsSchema = z.object({
  organizationId: z.string().uuid().transform((id) => id.toLowerCase()),
  paymentId: z.string().uuid().transform((id) => id.toLowerCase()),
}).strict();

/** No caller-selected actor, amount or status can enter a refund. */
export const refundPaymentBodySchema = z.object({ reason: z.string().min(1).max(2000) }).strict();

/** Recorded payments accept no client-selected amount, status, operator or actor. */
export const recordPaymentBodySchema = z.object({
  id: uuidV7Schema.transform((id) => id.toLowerCase()),
  plan: z.enum(['ESSENTIAL', 'PRO', 'ENTERPRISE']),
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  customer_tax_id: z.string().regex(/^[A-Za-z0-9]{1,20}$/).optional(),
  reason: z.string().min(1).max(2000),
}).strict();

/** Only the gift id, paid plan, bounded day count and reason are administrator-writable. */
export const giftDaysBodySchema = z.object({
  id: uuidV7Schema.transform((id) => id.toLowerCase()),
  plan: z.enum(['ESSENTIAL', 'PRO', 'ENTERPRISE']),
  days: z.number().int().min(1).max(365),
  reason: z.string().min(1).max(2000),
}).strict();

export const giftDaysParamsSchema = z.object({
  organizationId: uuidV7Schema.transform((id) => id.toLowerCase()),
}).strict();

/** Closed period projection; administrator identity and reason stay in the internal journal. */
export const giftDaysResponseSchema = z.object({
  id: uuidV7Schema,
  plan: z.enum(['ESSENTIAL', 'PRO', 'ENTERPRISE']),
  days: z.number().int().min(1).max(365),
  status: z.enum(['ACTIVE', 'SCHEDULED', 'ENDED']),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
}).strict();

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

/** The owner screen accepts no client-selected clock, identity or filtering. */
export const ownerBillingQuerySchema = z.object({}).strict();

const planCodeSchema = z.enum(['FREE', 'ESSENTIAL', 'PRO', 'ENTERPRISE']);

/** Closed subscription projection: no personal, payment, receipt or internal period data. */
export const ownerBillingResponseSchema = z.object({
  plan: planCodeSchema,
  plan_ends_at: z.string().datetime().nullable(),
  grace_ends_at: z.string().datetime().nullable(),
  max_collaborators: z.number().int().nonnegative().nullable(),
  max_products: z.number().int().nonnegative().nullable(),
  periods: z.array(z.object({
    plan: z.enum(['ESSENTIAL', 'PRO', 'ENTERPRISE']),
    status: z.enum(['ACTIVE', 'SCHEDULED']),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime(),
  }).strict()),
  usage: z.object({
    collaborators: z.number().int().nonnegative(),
    products: z.number().int().nonnegative(),
  }).strict(),
  after_end: z.object({
    plan: planCodeSchema,
    collaborators_to_pause: z.number().int().nonnegative(),
    products_to_pause: z.number().int().nonnegative(),
  }).strict().nullable(),
}).strict();

/** Owner swap fields only; UUID casing cannot bypass the distinct-seat rule. */
export const swapSeatBodySchema = z.object({
  id: uuidV7Schema,
  pause_collaboration_id: z.string().uuid(),
  resume_collaboration_id: z.string().uuid(),
}).strict().refine(
  (body) => body.pause_collaboration_id.toLowerCase() !== body.resume_collaboration_id.toLowerCase(),
  { message: 'Seats must be distinct', path: ['resume_collaboration_id'] },
);

export const swapSeatResponseSchema = z.object({
  paused_collaboration_id: z.string().uuid(),
  resumed_collaboration_id: z.string().uuid(),
}).strict();

/** Strict owner product fields; UUID casing cannot bypass the distinct-product rule. */
export const swapProductBodySchema = z.object({
  id: uuidV7Schema,
  pause_product_id: z.string().uuid(),
  resume_product_id: z.string().uuid(),
}).strict().refine(
  (body) => body.pause_product_id.toLowerCase() !== body.resume_product_id.toLowerCase(),
  { message: 'Products must be distinct', path: ['resume_product_id'] },
);

/** Explicit product swap projection, excluding catalog data. */
export const swapProductResponseSchema = z.object({
  paused_product_id: z.string().uuid(),
  resumed_product_id: z.string().uuid(),
}).strict();

export const keepChoiceResponseSchema = z.object({
  collaboration_ids: z.array(z.string().uuid()).max(100),
  product_ids: z.array(z.string().uuid()).max(100),
}).strict();

export const shopParamsSchema = z.object({ code: paymentCodeSchema }).strict();

/** Closed query lists reject duplicates, unlisted packs and client-supplied prices. */
export const quoteQuerySchema = z.object({
  plan: z.enum(['ESSENTIAL', 'PRO', 'ENTERPRISE']),
  months: z.enum(['1', '3', '6', '12']).transform((value): 1 | 3 | 6 | 12 => {
    switch (value) {
      case '1': return 1;
      case '3': return 3;
      case '6': return 6;
      case '12': return 12;
    }
  }),
}).strict();

/** Seven public fields only; internal rights and conversion periods are never exposed. */
export const quoteResponseSchema = z.object({
  name: z.string(),
  plan: z.enum(['ESSENTIAL', 'PRO', 'ENTERPRISE']),
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  price: z.number().int(),
  placement: z.enum(['NOW', 'QUEUED', 'UPGRADE']),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
}).strict();

/** Status accepts any UUID, but no query fields (ASVS 2.2.1). */
export const paymentStatusParamsSchema = z.object({ id: z.string().uuid() }).strict();
export const paymentStatusQuerySchema = z.object({}).strict();

/** Strict receipt paging; decode before loadActor can access the database. */
export const receiptListQuerySchema = paginationQuerySchema.extend({
  cursor: z.string().superRefine((value) => { decodeCursor(value); }).optional(),
}).strict();

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

/** Refunds expose the BIL-017 credit-note item, never its internal cancellation ids. */
export const refundPaymentResponseSchema = z.object({
  payment_id: z.string().uuid(),
  status: z.literal('REFUNDED'),
  credit_note: receiptViewSchema.extend({ kind: z.literal('CREDIT_NOTE') }),
}).strict();

/** Owner-only ten-field projection; the public payment receipt remains unchanged. */
export const receiptListResponseSchema = z.object({
  items: z.array(receiptViewSchema.extend({ kind: z.enum(['RECEIPT', 'CREDIT_NOTE']) })).max(100),
  next_cursor: z.string().nullable(),
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
