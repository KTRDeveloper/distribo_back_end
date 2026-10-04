import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { TEXT_MAX } from '../../shared/limits.js';
import { paginationQuerySchema } from '../../shared/pagination.js';

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
