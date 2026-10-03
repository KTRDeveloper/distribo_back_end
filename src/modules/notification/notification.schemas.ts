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
