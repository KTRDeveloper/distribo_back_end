import type { LedgerEntryKind } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
import type { Actor } from '../../types/express.js';
import {
  findOrganizationStatus,
  runInTransaction,
} from '../organization/organization.repository.js';
import { findSupplierRelationshipLocked } from '../relationship/relationship.repository.js';
import type { PaymentInput } from './finance.schemas.js';
import { appendLedgerEntry } from './ledger.service.js';

/** A ledger entry as the recorder sees it: an explicit field list, money in whole XAF. */
export type LedgerEntryView = {
  id: string;
  kind: LedgerEntryKind;
  amount: number;
  mode: 'CASH' | 'MOBILE_MONEY' | null;
  occurred_at: Date;
  balance: number;
};

/**
 * A SELLER or above records a customer's payment (FIN-004). One transaction (ASVS v5.0.0-2.3.3):
 * the organization must not be SUSPENDED (a CLOSED one may still collect), the relationship is
 * looked up and locked through the caller's own organization (another business's customer is 404,
 * v5.0.0-8.2.2), a counter is refused, and only an ACTIVE or ENDED relationship takes a payment.
 * The entry is written by `appendLedgerEntry`, which updates the balance and the recorder's held
 * money; the recorder is the caller and `occurred_at` is server time. Replays with the same `id`
 * are answered by `idempotent()`.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param relationshipId - Customer relationship from the path.
 * @param input - Validated body.
 * @returns The stored entry and the customer's balance after it.
 * @throws 404 `NOT_FOUND` (relationship outside the business); 409 `ORGANIZATION_NOT_ACTIVE`,
 * `COUNTER_ONLY_RETURNS`, `RELATIONSHIP_NOT_ACTIVE`.
 */
export function recordPayment(
  actor: Actor,
  relationshipId: string,
  input: PaymentInput
): Promise<LedgerEntryView> {
  return runInTransaction(async (tx) => {
    const status = await findOrganizationStatus(actor.organizationId, tx);
    if (status === null) throw httpError(404, 'NOT_FOUND', 'Not found');
    if (status === 'SUSPENDED') {
      throw httpError(409, 'ORGANIZATION_NOT_ACTIVE', 'Organization is not active');
    }

    const relationship = await findSupplierRelationshipLocked(
      tx,
      { personId: actor.personId, organizationId: actor.organizationId },
      relationshipId
    );
    if (!relationship) throw httpError(404, 'NOT_FOUND', 'Customer not found.');
    if (relationship.customerPersonId === null && relationship.customerOrganizationId === null) {
      throw httpError(409, 'COUNTER_ONLY_RETURNS', 'A counter only takes returns.');
    }
    if (relationship.status === 'PENDING') {
      throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'Relationship is not active');
    }

    const entry = await appendLedgerEntry(tx, {
      id: input.id,
      relationshipId: relationship.id,
      kind: 'PAYMENT',
      amount: BigInt(input.amount),
      mode: input.mode,
      transactionReference: input.transaction_reference,
      note: input.note,
      recordedById: actor.personId,
      organizationId: actor.organizationId,
      occurredAt: new Date(),
    });

    // The row is locked since the lookup, so the balance read before plus the entry's effect is exact.
    return {
      id: entry.id,
      kind: entry.kind,
      amount: Number(entry.amount),
      mode: entry.mode,
      occurred_at: entry.occurredAt,
      balance: Number(relationship.balance + entry.balanceEffect),
    };
  });
}
