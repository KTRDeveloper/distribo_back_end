import type { CollaborationRole, Prisma } from '@prisma/client';
import { classifyChanges, toEpoch } from '../sync.changes.js';
import { registerAdapter } from '../sync.registry.js';
import type { Row, SyncAdapter, Viewer } from '../sync.types.js';
import { refuseEveryLine } from './identity.adapter.js';
import { pushLedger, pushNotifications } from './ledger.push.js';

type Changes = { created: Row[]; updated: Row[]; deleted: string[] };

/** Roles that see the ledger of the organization; a DRIVER gets none. */
const LEDGER_ROLES: CollaborationRole[] = ['OWNER', 'MANAGER', 'SELLER'];
/** Roles that see every money record of the organization (expenses, handovers, credit limits). */
const MONEY_ROLES: CollaborationRole[] = ['OWNER', 'MANAGER'];
/** Roles that see who recorded a ledger entry (ASVS v5.0.0-8.2.3). */
const RECORDER_ROLES: CollaborationRole[] = ['OWNER', 'MANAGER'];

/** The last 90 days of money history stay on the phone (CM-30). */
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const PARTIES = {
  select: { supplierOrganizationId: true, customerPersonId: true },
} satisfies Prisma.CustomerRelationshipDefaultArgs;

type Parties = { supplierOrganizationId: string | null; customerPersonId: string | null };

const NONE: Changes = { created: [], updated: [], deleted: [] };

function organizationsWithRole(viewer: Viewer, roles: CollaborationRole[]): string[] {
  return viewer.memberships.filter((m) => roles.includes(m.role)).map((m) => m.organizationId);
}

function cutoff(): Date {
  return new Date(Date.now() - RETENTION_DAYS * DAY_MS);
}

/**
 * How a viewer relates to a relationship: the customer person always gets the customer view, even
 * when also a collaborator of the supplier; otherwise the role held in the supplier organization;
 * none means the row is dropped (fail closed).
 */
function roleOf(parties: Parties, viewer: Viewer): CollaborationRole | 'CUSTOMER' | null {
  if (parties.customerPersonId === viewer.personId) return 'CUSTOMER';
  const membership = viewer.memberships.find(
    (m) => m.organizationId === parties.supplierOrganizationId
  );
  return membership?.role ?? null;
}

/**
 * The relationships whose ledger a viewer may receive (ASVS v5.0.0-8.2.2): those of the
 * organizations where they are OWNER, MANAGER or SELLER, and those where they are the customer.
 */
function relationshipScope(viewer: Viewer): Prisma.CustomerRelationshipWhereInput {
  const branches: Prisma.CustomerRelationshipWhereInput[] = [{ customerPersonId: viewer.personId }];
  const orgs = organizationsWithRole(viewer, LEDGER_ROLES);
  if (orgs.length > 0) branches.push({ supplierOrganizationId: { in: orgs } });
  return { OR: branches };
}

/**
 * The expenses and handovers a viewer may receive, as OR branches on `organizationId`: all rows
 * of the organizations where they are OWNER or MANAGER and, for handovers only, the ones they sent
 * or received in the organizations where they hold another role. Built from ACTIVE memberships.
 */
function organizationScope(
  viewer: Viewer,
  own: Prisma.HandoverWhereInput | null
): Array<Prisma.HandoverWhereInput> {
  const branches: Prisma.HandoverWhereInput[] = [];
  const managed = organizationsWithRole(viewer, MONEY_ROLES);
  if (managed.length > 0) branches.push({ organizationId: { in: managed } });
  if (own) {
    const others = viewer.memberships
      .filter((m) => !MONEY_ROLES.includes(m.role))
      .map((m) => m.organizationId);
    if (others.length > 0) branches.push({ organizationId: { in: others }, ...own });
  }
  return branches;
}

/**
 * `ledger_entries`: the entries of the organization's relationships for OWNER, MANAGER and SELLER
 * (`recorded_by_id` for OWNER and MANAGER only), none for a DRIVER, and for a customer person the
 * entries of their own relationships without `recorded_by_id` and `transaction_reference`
 * (ASVS v5.0.0-8.2.3, v5.0.0-15.3.1). Last 90 days by `occurred_at` (CM-30). The ledger is never
 * deleted (C-35 `deleted_at` stays empty); an entry is `created` the first time it is sent.
 */
export const ledgerEntriesAdapter: SyncAdapter = {
  table: 'ledger_entries',
  async pull(viewer, since, tx): Promise<Changes> {
    const rows = await tx.ledgerEntry.findMany({
      where: {
        customerRelationship: relationshipScope(viewer),
        occurredAt: { gte: cutoff() },
        ...(since ? { serverUpdatedAt: { gt: since } } : {}),
      },
      include: { customerRelationship: PARTIES },
      orderBy: { id: 'asc' },
    });
    const allowed = rows.filter((r) => roleOf(r.customerRelationship, viewer) !== null);
    return classifyChanges(
      allowed.map((r) => ({ ...r, deletedAt: null })),
      since,
      (r) => r.serverUpdatedAt,
      (r) => {
        const role = roleOf(r.customerRelationship, viewer);
        const row: Row = {
          id: r.id,
          customer_relationship_id: r.customerRelationshipId,
          order_id: r.orderId,
          kind: r.kind,
          amount: Number(r.amount),
          balance_effect: Number(r.balanceEffect),
          mode: r.mode,
          reverses_entry_id: r.reversesEntryId,
          note: r.note,
          occurred_at: toEpoch(r.occurredAt),
          server_updated_at: toEpoch(r.serverUpdatedAt),
        };
        if (role !== 'CUSTOMER') row['transaction_reference'] = r.transactionReference;
        if (role !== null && role !== 'CUSTOMER' && RECORDER_ROLES.includes(role)) {
          row['recorded_by_id'] = r.recordedById;
        }
        return row;
      }
    );
  },
  push: pushLedger,
};

/**
 * A row stays on the phone while its `occurred_at` or its `cancelled_at` is within the last 90
 * days, so a cancellation of an older record is still learnt (CM-30).
 */
function recentOrCancelled(): Prisma.ExpenseWhereInput {
  const from = cutoff();
  return { OR: [{ occurredAt: { gte: from } }, { cancelledAt: { gte: from } }] };
}

/** Live rows within retention; with `includeGone` the soft-deleted rows of the scope too (C-35). */
function liveOrGone(includeGone: boolean): Prisma.ExpenseWhereInput {
  const live = { AND: [{ deletedAt: null }, recentOrCancelled()] };
  return includeGone ? { OR: [live, { deletedAt: { not: null } }] } : live;
}

/**
 * `expenses`: every expense of the organization for OWNER and MANAGER; none for others. Last 90
 * days by `occurred_at` or `cancelled_at` (CM-30). An expense is only ever edited by being
 * cancelled, so an uncancelled row is new when sent and a cancelled one is an update.
 */
export const expensesAdapter: SyncAdapter = {
  table: 'expenses',
  async pull(viewer, since, tx): Promise<Changes> {
    const orgs = organizationsWithRole(viewer, MONEY_ROLES);
    if (orgs.length === 0) return NONE;
    const rows = await tx.expense.findMany({
      where: {
        AND: [
          { organizationId: { in: orgs } },
          liveOrGone(since !== null),
          since ? { serverUpdatedAt: { gt: since } } : {},
        ],
      },
      orderBy: { id: 'asc' },
    });
    return classifyChanges(
      rows,
      since,
      (r) => (r.cancelledAt ? r.occurredAt : r.serverUpdatedAt),
      (r) => ({
        id: r.id,
        organization_id: r.organizationId,
        paid_by_id: r.paidById,
        amount: Number(r.amount),
        category: r.category,
        description: r.description,
        recorded_by_id: r.recordedById,
        occurred_at: toEpoch(r.occurredAt),
        cancelled_at: r.cancelledAt ? toEpoch(r.cancelledAt) : null,
        cancelled_by_id: r.cancelledById,
        server_updated_at: toEpoch(r.serverUpdatedAt),
      })
    );
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

/**
 * `handovers`: every handover of the organization for OWNER and MANAGER; for a SELLER or DRIVER
 * only those where they are the sender or the receiver. Last 90 days by `occurred_at` or
 * `cancelled_at` (CM-30), classified like expenses.
 */
export const handoversAdapter: SyncAdapter = {
  table: 'handovers',
  async pull(viewer, since, tx): Promise<Changes> {
    const scope = organizationScope(viewer, {
      OR: [{ fromPersonId: viewer.personId }, { toPersonId: viewer.personId }],
    });
    if (scope.length === 0) return NONE;
    const rows = await tx.handover.findMany({
      where: {
        AND: [
          { OR: scope },
          liveOrGone(since !== null) as Prisma.HandoverWhereInput,
          since ? { serverUpdatedAt: { gt: since } } : {},
        ],
      },
      orderBy: { id: 'asc' },
    });
    return classifyChanges(
      rows,
      since,
      (r) => (r.cancelledAt ? r.occurredAt : r.serverUpdatedAt),
      (r) => ({
        id: r.id,
        organization_id: r.organizationId,
        from_person_id: r.fromPersonId,
        to_person_id: r.toPersonId,
        amount: Number(r.amount),
        occurred_at: toEpoch(r.occurredAt),
        cancelled_at: r.cancelledAt ? toEpoch(r.cancelledAt) : null,
        cancelled_by_id: r.cancelledById,
        server_updated_at: toEpoch(r.serverUpdatedAt),
      })
    );
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

/**
 * `credit_limit_changes`: the journal of the organization's relationships for OWNER and MANAGER;
 * none for anyone else. Last 90 days by `set_at` (CM-30). The journal only grows, so `deleted_at`
 * stays empty and each entry is `created` when first sent.
 */
export const creditLimitChangesAdapter: SyncAdapter = {
  table: 'credit_limit_changes',
  async pull(viewer, since, tx): Promise<Changes> {
    const orgs = organizationsWithRole(viewer, MONEY_ROLES);
    if (orgs.length === 0) return NONE;
    const rows = await tx.creditLimitChange.findMany({
      where: {
        customerRelationship: { supplierOrganizationId: { in: orgs } },
        setAt: { gte: cutoff() },
        ...(since ? { serverUpdatedAt: { gt: since } } : {}),
      },
      orderBy: { id: 'asc' },
    });
    return classifyChanges(
      rows.map((r) => ({ ...r, deletedAt: null })),
      since,
      (r) => r.serverUpdatedAt,
      (r) => ({
        id: r.id,
        customer_relationship_id: r.customerRelationshipId,
        previous_limit: r.previousLimit === null ? null : Number(r.previousLimit),
        new_limit: r.newLimit === null ? null : Number(r.newLimit),
        set_by_id: r.setById,
        set_at: toEpoch(r.setAt),
        server_updated_at: toEpoch(r.serverUpdatedAt),
      })
    );
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

/**
 * `notifications`: the viewer's own rows only (`recipient_id`, from the session, never from the
 * client; ASVS v5.0.0-8.2.2): every unread one and the read ones of the last 90 days (CM-30).
 * Deleted rows are listed in `deleted` (C-35).
 */
export const notificationsAdapter: SyncAdapter = {
  table: 'notifications',
  async pull(viewer, since, tx): Promise<Changes> {
    const live: Prisma.NotificationWhereInput = {
      deletedAt: null,
      OR: [{ readStatus: 'UNREAD' }, { createdAt: { gte: cutoff() } }],
    };
    const rows = await tx.notification.findMany({
      where: {
        recipientId: viewer.personId,
        ...(since
          ? { OR: [live, { deletedAt: { not: null } }], serverUpdatedAt: { gt: since } }
          : live),
      },
      orderBy: { id: 'asc' },
    });
    return classifyChanges(
      rows,
      since,
      (r) => r.createdAt,
      (r) => ({
        id: r.id,
        recipient_id: r.recipientId,
        organization_id: r.organizationId,
        content: r.content,
        source_event: r.sourceEvent,
        related_entity_type: r.relatedEntityType,
        related_entity_id: r.relatedEntityId,
        read_status: r.readStatus,
        created_at: toEpoch(r.createdAt),
        server_updated_at: toEpoch(r.serverUpdatedAt),
      })
    );
  },
  push: pushNotifications,
};

export const moneyAdapters: SyncAdapter[] = [
  ledgerEntriesAdapter,
  expensesAdapter,
  handoversAdapter,
  creditLimitChangesAdapter,
  notificationsAdapter,
];

/** Registers the money adapters; called once when the sync routes are built. */
export function registerMoneyAdapters(): void {
  for (const adapter of moneyAdapters) registerAdapter(adapter);
}
