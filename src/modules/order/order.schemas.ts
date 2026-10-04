import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { TEXT_MAX } from '../../shared/limits.js';
import { parseQuantity } from '../../shared/money.js';

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
