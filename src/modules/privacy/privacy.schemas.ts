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

/** Body of DELETE /users/me: the current password, as typed (v5.0.0-6.2.3). Max matches the password rules. */
export const deleteAccountBodySchema = openApiRegistry.register(
  'DeleteAccountRequest',
  z.object({ password: z.string().min(1).max(256) }).strict()
);

export type DeleteAccountInput = z.infer<typeof deleteAccountBodySchema>;

/** 409 body of DELETE /users/me: the error plus what blocks the deletion. */
export const deletionBlockedResponseSchema = openApiRegistry.register(
  'DeletionBlocked',
  z.object({
    error: z.object({
      code: z.literal('DELETION_BLOCKED'),
      message: z.string(),
      blockers: z.array(deletionBlockerSchema),
      requestId: z.string().optional(),
    }),
  })
);
