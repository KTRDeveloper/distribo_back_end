import type { AdminAction, Prisma } from '@prisma/client';
import { newId } from '../../shared/ids.js';

/** Kinds of administrator action recorded in the journal. */
export type AdminActionType =
  | 'SUSPEND'
  | 'REACTIVATE'
  | 'DISMISS_REPORT'
  | 'APPOINT_ADMIN'
  | 'REMOVE_ADMIN'
  | 'REPLAY_SYNC'
  | 'RECOVER_2FA';

/** Fields a caller supplies; the id and the server time are never client-provided. */
export interface AdminActionInput {
  administratorId: string;
  action: AdminActionType;
  /** Exactly one of targetPersonId and targetOrganizationId (enforced by the database). */
  targetPersonId?: string | null;
  targetOrganizationId?: string | null;
  reportId?: string | null;
  /** Required for REPLAY_SYNC, forbidden otherwise (enforced by the database). */
  syncArchiveId?: string | null;
  reason: string;
}

/**
 * Appends one entry to the immutable administration journal (v5.0.0-16.3.1).
 *
 * Takes a transaction client so the entry is saved atomically with the action it
 * records. Generates a new UUIDv7 id; `occurred_at` is set by the database.
 * Database rule violations (targets, reason, REPLAY_SYNC role) surface as
 * errors and abort the surrounding transaction (fail closed).
 *
 * @param tx Transaction client of the action being recorded.
 * @param input Author, action, target and reason.
 * @returns The inserted row.
 */
export async function recordAdminAction(
  tx: Prisma.TransactionClient,
  input: AdminActionInput
): Promise<AdminAction> {
  return tx.adminAction.create({
    data: {
      id: newId(),
      administratorId: input.administratorId,
      action: input.action,
      targetPersonId: input.targetPersonId ?? null,
      targetOrganizationId: input.targetOrganizationId ?? null,
      reportId: input.reportId ?? null,
      syncArchiveId: input.syncArchiveId ?? null,
      reason: input.reason,
    },
  });
}
