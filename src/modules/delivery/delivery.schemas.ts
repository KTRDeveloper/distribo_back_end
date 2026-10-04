import { z } from 'zod';
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
