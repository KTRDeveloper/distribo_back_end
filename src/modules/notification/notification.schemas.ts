import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/pagination.js';

/** Strict list query: unknown parameters are rejected; unread accepts only "true". */
export const listNotificationsQuerySchema = paginationQuerySchema
  .extend({
    unread: z
      .literal('true')
      .transform(() => true)
      .optional(),
  })
  .strict();

/** Read routes take no body fields. */
export const emptyBodySchema = z.object({}).strict();

/** Path parameter of the mark-one route. */
export const notificationIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
