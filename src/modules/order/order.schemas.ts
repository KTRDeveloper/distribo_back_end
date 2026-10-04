import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { TEXT_MAX } from '../../shared/limits.js';
import { parseQuantity } from '../../shared/money.js';
import { paginationQuerySchema } from '../../shared/pagination.js';

/** Largest quantity `numeric(12,3)` holds, in thousandths. */
const QUANTITY_MAX_MILLI = 999_999_999_999n;

/** Most lines one order may carry (ORD-009). */
export const ORDER_LINES_MAX = 100;

/**
 * Ordered quantity: a decimal string or a number, greater than 0, at most 3 decimals and within
 * `numeric(12,3)` (ASVS v5.0.0-2.2.1). The output is the canonical string.
 */
const quantitySchema = z.union([z.number(), z.string().max(32)]).transform((value, ctx) => {
  const text = typeof value === 'number' ? String(value) : value;
  try {
    const milli = parseQuantity(text);
    if (milli > 0n && milli <= QUANTITY_MAX_MILLI) return text;
  } catch {
    // A malformed quantity is reported as a validation issue below, never as a 500.
  }
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_quantity' });
  return z.NEVER;
});

/** A real calendar day written YYYY-MM-DD. */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((text) => {
    const date = new Date(`${text}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
  });

/**
 * One order line: only ids and a quantity. Prices, amounts and labels are never accepted; the
 * server freezes them from the catalog (ASVS v5.0.0-2.2.1, v5.0.0-15.3.3, CWE-915).
 */
const placeOrderLineSchema = z
  .object({ id: uuidV7Schema, product_id: uuidV7Schema, quantity: quantitySchema })
  .strict();

/**
 * Strict body of the place-order gesture (ASVS v5.0.0-15.3.3). The customer, the relationship, the
 * status, the totals and the placing party are never accepted: the server sets them (v5.0.0-8.2.2).
 */
export const placeOrderSchema = z
  .object({
    id: uuidV7Schema,
    supplier_organization_id: uuidV7Schema,
    delivery_address: z.string().trim().min(1).max(TEXT_MAX).optional(),
    desired_delivery_date: dateSchema.optional(),
    customer_note: z.string().max(TEXT_MAX).optional(),
    lines: z.array(placeOrderLineSchema).min(1).max(ORDER_LINES_MAX),
  })
  .strict()
  .refine((body) => new Set(body.lines.map((line) => line.id)).size === body.lines.length, {
    message: 'duplicate_line_id',
    path: ['lines'],
  });

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/** Body of the organization purchase (ORD-010): the same strict body as a person's order. */
export const placePurchaseSchema = placeOrderSchema;

/** Path of the accept gesture: the order id is a UUID, so a malformed one never reaches the database. */
export const orderIdParamSchema = z.object({ orderId: uuidV7Schema }).strict();

/**
 * One lowered price: a line and a whole-franc price from 0 up. The upper bound is the line's own
 * current price, checked against the database in the service, not here (ASVS v5.0.0-15.3.3: only
 * line ids and prices are writable).
 */
const linePriceSchema = z
  .object({
    line_id: uuidV7Schema,
    unit_price_applied: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

/**
 * Strict body of the accept gesture (ORD-011): the gesture id and, optionally, lowered prices for
 * up to 100 distinct lines. Status, amounts, totals and the price author are never accepted.
 */
export const acceptOrderSchema = z
  .object({
    id: uuidV7Schema,
    line_prices: z.array(linePriceSchema).max(ORDER_LINES_MAX).optional(),
  })
  .strict()
  .refine(
    (body) =>
      new Set(body.line_prices?.map((line) => line.line_id)).size ===
      (body.line_prices ?? []).length,
    { message: 'duplicate_line_id', path: ['line_prices'] }
  );

export type AcceptInput = z.infer<typeof acceptOrderSchema>;

/**
 * Strict body of the refuse gesture (ORD-012): the gesture id and a reason of 1 to 2000 characters
 * once trimmed. Status, party, author and time are set by the server (ASVS v5.0.0-15.3.3).
 */
export const refuseOrderSchema = z
  .object({ id: uuidV7Schema, reason: z.string().trim().min(1).max(TEXT_MAX) })
  .strict();

export type RefuseInput = z.infer<typeof refuseOrderSchema>;

/**
 * Strict body of the supplier cancel gesture (ORD-016): the gesture id and a reason of 1 to 2000
 * characters once trimmed. Status, party, author and time are set by the server (v5.0.0-15.3.3).
 */
export const cancelOrderSchema = z
  .object({ id: uuidV7Schema, reason: z.string().trim().min(1).max(TEXT_MAX) })
  .strict();

export type CancelInput = z.infer<typeof cancelOrderSchema>;

/**
 * Strict body of the customer cancel gesture (ORD-017): the gesture id and an optional reason of
 * 1 to 2000 characters once trimmed. Status, party, author and time are set by the server
 * (v5.0.0-15.3.3).
 */
export const cancelOrderAsCustomerSchema = z
  .object({ id: uuidV7Schema, reason: z.string().trim().min(1).max(TEXT_MAX).optional() })
  .strict();

export type CancelAsCustomerInput = z.infer<typeof cancelOrderAsCustomerSchema>;

/**
 * One line entered by a seller: ids, a quantity and, optionally, a price from 0 up. The reference
 * price, the label and the amount are never accepted (ASVS v5.0.0-15.3.3, CWE-915).
 */
const enterOrderLineSchema = z
  .object({
    id: uuidV7Schema,
    product_id: uuidV7Schema,
    quantity: quantitySchema,
    unit_price_applied: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

/**
 * Strict body of the seller's enter-order gesture (ORD-013). Status, party, author, totals and
 * reference prices are never accepted: the server sets them (ASVS v5.0.0-15.3.3). The supplier is
 * the caller's organization, from the path.
 */
export const enterOrderSchema = z
  .object({
    id: uuidV7Schema,
    customer_relationship_id: uuidV7Schema,
    delivery_address: z.string().trim().min(1).max(TEXT_MAX).optional(),
    delivery_cost: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    desired_delivery_date: dateSchema.optional(),
    customer_note: z.string().max(TEXT_MAX).optional(),
    lines: z.array(enterOrderLineSchema).min(1).max(ORDER_LINES_MAX),
  })
  .strict()
  .refine((body) => new Set(body.lines.map((line) => line.id)).size === body.lines.length, {
    message: 'duplicate_line_id',
    path: ['lines'],
  });

export type EnterOrderInput = z.infer<typeof enterOrderSchema>;

/**
 * Strict body of the seller's edit-order gesture (ORD-014): the gesture id and at least one of the
 * editable fields. Each scalar may be `null` to clear it; `lines` is the full replacement list.
 * Status, party, author, totals and reference prices are never accepted (ASVS v5.0.0-15.3.3).
 */
export const editOrderSchema = z
  .object({
    id: uuidV7Schema,
    delivery_address: z.string().trim().min(1).max(TEXT_MAX).nullable().optional(),
    delivery_cost: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    desired_delivery_date: dateSchema.nullable().optional(),
    customer_note: z.string().max(TEXT_MAX).nullable().optional(),
    lines: z.array(enterOrderLineSchema).min(1).max(ORDER_LINES_MAX).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.delivery_address !== undefined ||
      body.delivery_cost !== undefined ||
      body.desired_delivery_date !== undefined ||
      body.customer_note !== undefined ||
      body.lines !== undefined,
    { message: 'at_least_one_field', path: [] }
  )
  .refine(
    (body) =>
      body.lines === undefined ||
      new Set(body.lines.map((line) => line.id)).size === body.lines.length,
    { message: 'duplicate_line_id', path: ['lines'] }
  );

export type EditOrderInput = z.infer<typeof editOrderSchema>;

/**
 * Strict body of the seller's note gesture (ORD-015): the note itself, up to 2000 characters, or
 * `null` to clear it. Nothing else is writable on a finished order (ASVS v5.0.0-15.3.3).
 */
export const setSupplierNoteSchema = z
  .object({ supplier_note: z.string().max(TEXT_MAX).nullable() })
  .strict();

export type SetSupplierNoteInput = z.infer<typeof setSupplierNoteSchema>;

/**
 * Strict query of the seller's order list: `limit`, `cursor`, one status and one customer
 * relationship. Any other field or value is a 400 (ASVS v5.0.0-2.2.1).
 */
export const listOrdersQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(['PENDING', 'CONFIRMED', 'IN_DELIVERY', 'DELIVERED', 'CANCELLED']).optional(),
    customer_relationship_id: uuidV7Schema.optional(),
  })
  .strict();

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
