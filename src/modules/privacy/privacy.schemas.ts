import { z } from 'zod';
import { openApiRegistry } from '../../lib/openapi/registry.js';

/** One reason the account cannot be deleted yet. */
export const deletionBlockerSchema = z.object({
  code: z.enum(['POSITIVE_BALANCE', 'OWNS_ORGANIZATION']),
  label: z.string(),
});

/** Response of GET /users/me/deletion-check. */
export const deletionCheckResponseSchema = openApiRegistry.register(
  'DeletionCheck',
  z.object({
    can_delete: z.boolean(),
    blockers: z.array(deletionBlockerSchema),
  })
);

export type DeletionCheck = z.infer<typeof deletionCheckResponseSchema>;
