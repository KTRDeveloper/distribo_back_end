import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { TEXT_MAX } from '../../shared/limits.js';
import { paginationQuerySchema } from '../../shared/pagination.js';
import { enterOrderLineSchema, ORDER_LINES_MAX } from '../order/order.schemas.js';

/** Strict query of the to-deliver pool: `limit` and `cursor` only (ASVS v5.0.0-2.2.1). */
export const toDeliverQuerySchema = paginationQuerySchema.strict();

export type PageQuery = z.infer<typeof toDeliverQuerySchema>;

/** The states of a driver's own delivery list: neither arrived nor failed, arrived, failed. */
export const MINE_STATUSES = ['in_progress', 'done', 'failed'] as const;

/** Strict query of the driver's own deliveries: `limit`, `cursor` and one optional status. */
export const mineQuerySchema = paginationQuerySchema
  .extend({ status: z.enum(MINE_STATUSES).optional() })
  .strict();

export type MineQuery = z.infer<typeof mineQuerySchema>;

/** Path of the assign gesture: the order id is a UUID, so a malformed one never reaches the database. */
export const assignParamSchema = z.object({ orderId: uuidV7Schema }).strict();

/**
 * Strict body of the assign gesture (DLV-004): the gesture id, which becomes the delivery id, and
 * the driver. Order, organization, status and times are never accepted (ASVS v5.0.0-15.3.3).
 */
export const assignDeliverySchema = z
  .object({ id: uuidV7Schema, driver_person_id: uuidV7Schema })
  .strict();

export type AssignDeliveryInput = z.infer<typeof assignDeliverySchema>;

/**
 * Strict body of the depart gesture (DLV-005): only the gesture id, which becomes the delivery id
 * when a delivery is created. Driver, order and times are never accepted (ASVS v5.0.0-15.3.3).
 */
export const departSchema = z.object({ id: uuidV7Schema }).strict();

export type DepartInput = z.infer<typeof departSchema>;

/** Path of the fail gesture: the delivery id is a UUID, so a malformed one never reaches the database. */
export const deliveryParamSchema = z.object({ deliveryId: uuidV7Schema }).strict();

/**
 * Strict body of the fail gesture (DLV-006): the gesture id and a reason of 1 to 2000 characters.
 * Delivery, driver and times are never accepted (ASVS v5.0.0-15.3.3).
 */
export const failDeliverySchema = z
  .object({ id: uuidV7Schema, reason: z.string().trim().min(1).max(TEXT_MAX) })
  .strict();

export type FailDeliveryInput = z.infer<typeof failDeliverySchema>;

/** Upper bound of an amount collected at delivery, in XAF: explicit maximum (ASVS v5.0.0-2.2.1). */
const COLLECTED_MAX = 999_999_999_999;

/** Upper bound of the lines a deliver body may list: explicit maximum (ASVS v5.0.0-2.2.1). */
const DELIVERED_LINES_MAX = 200;

/** A plain decimal with at most 3 places, as `parseQuantity` accepts it (ASVS v5.0.0-2.2.1). */
const QUANTITY_FORMAT = /^\d{1,9}(\.\d{1,3})?$/;

/**
 * A delivered quantity sent as a decimal string or a number: plain notation, from 0, at most 3
 * decimal places. The upper bound (the ordered quantity) depends on the line and is the service's.
 */
const deliveredQuantitySchema = z.union([
  z.string().regex(QUANTITY_FORMAT),
  z.number().refine((value) => QUANTITY_FORMAT.test(String(value)), 'Invalid quantity'),
]);

/** One line of a partial delivery: the line and what was really delivered; no amount (CM-14). */
const deliveredLineSchema = z
  .object({ line_id: uuidV7Schema, delivered_quantity: deliveredQuantitySchema })
  .strict();

/**
 * Strict body of the deliver gesture (DLV-007, DLV-008): the gesture id, the amount collected, its
 * mode and the ids of the ledger entries the gesture creates, and for a partial delivery the
 * delivered quantity per short line (unlisted lines are fully delivered) and what happens to the
 * rest. The sale amount, a line amount, a kind, the order total, the recorder and times are never
 * accepted (CM-13; ASVS v5.0.0-2.2.1, v5.0.0-15.3.3). A collection above 0 needs a mode and a
 * payment entry id; with 0 neither is used. Whether a line is short, hence whether `rest` is
 * required, depends on the order and is the service's check.
 */
export const deliverSchema = z
  .object({
    id: uuidV7Schema,
    collected_amount: z.number().int().min(0).max(COLLECTED_MAX),
    mode: z.enum(['CASH', 'MOBILE_MONEY']).optional(),
    sale_entry_id: uuidV7Schema,
    payment_entry_id: uuidV7Schema.optional(),
    lines: z.array(deliveredLineSchema).min(1).max(DELIVERED_LINES_MAX).optional(),
    rest: z.enum(['LATER', 'ABANDON']).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.lines &&
      new Set(value.lines.map((line) => line.line_id)).size !== value.lines.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lines'],
        message: 'A line can be listed once',
      });
    }
    if (value.collected_amount > 0 && value.mode === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['mode'], message: 'Required' });
    }
    if (value.collected_amount > 0 && value.payment_entry_id === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment_entry_id'],
        message: 'Required',
      });
    }
    if (value.payment_entry_id !== undefined && value.payment_entry_id === value.sale_entry_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment_entry_id'],
        message: 'Must differ from sale_entry_id',
      });
    }
  });

export type DeliverInput = z.infer<typeof deliverSchema>;

/**
 * Strict body of the counter-sale gesture (DLV-009): the gesture id, the ids of the SALE and the
 * PAYMENT entries, the lines as in ORD-013 (the price is the server's unless a seller sets a gap),
 * the amount collected and its mode. The sale amount, the total, the status, the recorder and the
 * delivery are never accepted (CM-13; ASVS v5.0.0-2.2.1, v5.0.0-15.3.3). Whether the collected
 * amount equals the total depends on the prices and is the service's check (C-26).
 */
export const counterSaleSchema = z
  .object({
    id: uuidV7Schema,
    sale_entry_id: uuidV7Schema,
    payment_entry_id: uuidV7Schema,
    lines: z.array(enterOrderLineSchema).min(1).max(ORDER_LINES_MAX),
    collected_amount: z.number().int().min(0).max(COLLECTED_MAX),
    mode: z.enum(['CASH', 'MOBILE_MONEY']),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.lines.map((line) => line.id)).size !== value.lines.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lines'],
        message: 'A line can be listed once',
      });
    }
    if (value.payment_entry_id === value.sale_entry_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment_entry_id'],
        message: 'Must differ from sale_entry_id',
      });
    }
  });

export type CounterSaleInput = z.infer<typeof counterSaleSchema>;

/** Path of the counter-sale gesture: the relationship id is a UUID (never reaches the database malformed). */
export const counterParamSchema = z.object({ relationshipId: uuidV7Schema }).strict();

/** True for a real calendar date written `YYYY-MM-DD` (no `2026-02-30`). */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/**
 * Strict query of the unsettled deliveries (DLV-011): one optional `date` (`YYYY-MM-DD`, a real
 * calendar day, read in the Africa/Douala time zone). Any other field is a 400 (ASVS v5.0.0-2.2.1).
 */
export const unsettledQuerySchema = z
  .object({ date: z.string().refine(isCalendarDate, 'invalid_date').optional() })
  .strict();

export type UnsettledQuery = z.infer<typeof unsettledQuerySchema>;
