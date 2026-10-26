import type { CollaborationRole, Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { newId } from '../../shared/ids.js';
import { getReferencePrice } from '../catalog/catalog.repository.js';

/** Reads a person's scope version and ACTIVE memberships; null when the person does not exist. */
export async function findViewerData(personId: string): Promise<{
  scopeVersion: number;
  memberships: Array<{ organizationId: string; role: CollaborationRole }>;
} | null> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      scopeVersion: true,
      collaborations: {
        where: { status: 'ACTIVE', deletedAt: null },
        select: { organizationId: true, role: true },
      },
    },
  });
  return person ? { scopeVersion: person.scopeVersion, memberships: person.collaborations } : null;
}

/**
 * Runs the reads of one pull on a single snapshot, so every table of the response agrees with the
 * others (REPEATABLE READ).
 */
export async function withPullSnapshot<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(work, { isolationLevel: 'RepeatableRead' });
}

/**
 * True when the person's device is revoked. A device row that does not exist counts as not
 * revoked: the lookup filters on the person as well, so another person's device is never read.
 */
export async function isDeviceRevoked(personId: string, deviceId: string): Promise<boolean> {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, personId },
    select: { revokedAt: true },
  });
  return device?.revokedAt != null;
}

/**
 * What a push needs to judge a device whose phone missed a rights change (SYNC-019): the scope
 * version the device last saw, and the organizations where the person's membership was REVOKED or
 * PAUSED (with the role they held; SYNC-039). A device that does not exist or is not the person's has seen nothing
 * (null).
 */
export async function findRightsHistory(
  personId: string,
  deviceId: string
): Promise<{
  scopeVersionSeen: number;
  formerMemberships: Array<{ organizationId: string; role: CollaborationRole }>;
} | null> {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, personId },
    select: { scopeVersionSeen: true },
  });
  if (!device) return null;
  const former = await prisma.collaboration.findMany({
    where: { personId, status: { in: ['REVOKED', 'PAUSED'] }, deletedAt: null },
    select: { organizationId: true, role: true },
  });
  return { scopeVersionSeen: device.scopeVersionSeen, formerMemberships: former };
}

/**
 * Records a pull on the person's live device: `last_synced_at` is server time, and
 * `scope_version_seen` is written only when `scopeVersionSeen` is given. The update filters on
 * person and device together and skips revoked devices (C-34).
 */
export async function markDevicePulled(
  personId: string,
  deviceId: string,
  scopeVersionSeen: number | null
): Promise<void> {
  await prisma.device.updateMany({
    where: { id: deviceId, personId, revokedAt: null },
    data: {
      lastSyncedAt: new Date(),
      ...(scopeVersionSeen === null ? {} : { scopeVersionSeen }),
    },
  });
}

/**
 * Stores the batch exactly as received, in its own committed statement: it stays even when the push
 * is later refused or fails (ASVS v5.0.0-16.3.1). Returns the archive id.
 */
export async function archiveBatch(
  personId: string,
  deviceId: string,
  changes: Prisma.InputJsonValue
): Promise<string> {
  const archive = await prisma.syncArchive.create({
    data: { id: newId(), personId, deviceId, changes },
    select: { id: true },
  });
  return archive.id;
}

/** An archived batch as a replay reads it: its author, device, receipt time and the stored changes. */
export type ArchivedBatch = {
  id: string;
  personId: string;
  deviceId: string;
  receivedAt: Date;
  changes: unknown;
};

/** Reads one archived batch by id; null when none exists (SYNC-022). */
export async function findArchive(archiveId: string): Promise<ArchivedBatch | null> {
  return prisma.syncArchive.findUnique({
    where: { id: archiveId },
    select: { id: true, personId: true, deviceId: true, receivedAt: true, changes: true },
  });
}

/** An archive row as the administrators' list reads it, with its stored changes. */
export type ArchiveRow = ArchivedBatch;

/**
 * One page of archived batches, newest first then by id (SYNC-023). `from` is inclusive and
 * `toExclusive` exclusive; `cursor` is the last row of the previous page.
 */
export async function findArchivePage(filter: {
  personId?: string;
  from?: Date;
  toExclusive?: Date;
  cursor?: { createdAt: Date; id: string };
  take: number;
}): Promise<ArchiveRow[]> {
  const { personId, from, toExclusive, cursor, take } = filter;
  return prisma.syncArchive.findMany({
    where: {
      AND: [
        ...(personId ? [{ personId }] : []),
        ...(from ? [{ receivedAt: { gte: from } }] : []),
        ...(toExclusive ? [{ receivedAt: { lt: toExclusive } }] : []),
        ...(cursor
          ? [
              {
                OR: [
                  { receivedAt: { lt: cursor.createdAt } },
                  { receivedAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
    take,
    select: { id: true, personId: true, deviceId: true, receivedAt: true, changes: true },
  });
}

/** Runs the conflict check and the judging of one push in a single transaction (ASVS v5.0.0-2.3.3). */
export async function withPushTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(work);
}

/** The nine tables the judge reads and scopes. */
export type JudgedTable =
  | 'customer_relationships'
  | 'products'
  | 'product_variants'
  | 'customer_prices'
  | 'orders'
  | 'order_lines'
  | 'deliveries'
  | 'ledger_entries'
  | 'notifications';

/** Who a stored or referenced row belongs to: its supplier organization, its customer person. */
export type RowOwner = { organizationId: string | null; customerPersonId: string | null };

/** A stored row as the judge compares it: scalar columns in snake_case, plus who owns it. */
export type StoredRow = { row: Record<string, unknown>; owner: RowOwner };

const OWNER_SELECT = { supplierOrganizationId: true, customerPersonId: true } as const;
type OwnerColumns = { supplierOrganizationId: string | null; customerPersonId: string | null };

const ownerOf = (r: OwnerColumns): RowOwner => ({
  organizationId: r.supplierOrganizationId,
  customerPersonId: r.customerPersonId,
});

/** A row owned by a business alone: only an ACTIVE member of it is in scope. */
const businessOwner = (organizationId: string | null): RowOwner => ({
  organizationId,
  customerPersonId: null,
});

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Keeps the scalar columns of a Prisma row and names them as a phone does. */
function toSnakeRow(entity: object): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    const isRelation =
      value !== null &&
      typeof value === 'object' &&
      !(value instanceof Date) &&
      !('toFixed' in value && 'toNumber' in value);
    if (!isRelation) row[snakeCase(key)] = value;
  }
  return row;
}

/**
 * Who owns the relationship `id`, or null when it does not exist. The reads below run on the
 * transaction of the push and take only an id already checked as a UUID.
 */
export async function findRelationshipOwner(
  tx: Prisma.TransactionClient,
  id: string
): Promise<RowOwner | null> {
  const found = await tx.customerRelationship.findUnique({ where: { id }, select: OWNER_SELECT });
  return found ? ownerOf(found) : null;
}

/**
 * Who owns the product `id`: its organization (a product has no customer), or null when it does
 * not exist. A new variant takes its business from here, never from a phone.
 */
export async function findProductOwner(
  tx: Prisma.TransactionClient,
  id: string
): Promise<RowOwner | null> {
  const found = await tx.product.findUnique({ where: { id }, select: { organizationId: true } });
  return found ? { organizationId: found.organizationId, customerPersonId: null } : null;
}

/** Who owns the order `id` through its relationship, or null when it does not exist. */
export async function findOrderOwner(
  tx: Prisma.TransactionClient,
  id: string
): Promise<RowOwner | null> {
  const found = await tx.order.findUnique({
    where: { id },
    select: { customerRelationship: { select: OWNER_SELECT } },
  });
  return found ? ownerOf(found.customerRelationship) : null;
}

/**
 * Reads the stored row `id` of a judged table with its owner, or null when absent. The judge
 * compares a pushed update with this row, so only the server's own version is ever trusted.
 */
export async function findStoredRow(
  tx: Prisma.TransactionClient,
  table: JudgedTable,
  id: string
): Promise<StoredRow | null> {
  const withRelationship = { customerRelationship: { select: OWNER_SELECT } };
  const withOrder = { order: { select: withRelationship } };
  switch (table) {
    case 'products': {
      const r = await tx.product.findUnique({ where: { id } });
      return r ? { row: toSnakeRow(r), owner: businessOwner(r.organizationId) } : null;
    }
    case 'product_variants': {
      const r = await tx.productVariant.findUnique({ where: { id } });
      return r ? { row: toSnakeRow(r), owner: businessOwner(r.organizationId) } : null;
    }
    case 'customer_prices': {
      const found = await tx.customerPrice.findUnique({ where: { id }, include: withRelationship });
      if (!found) return null;
      const { customerRelationship, ...r } = found;
      // The supplier's staff alone own a price: the customer person is not an owner of it.
      return {
        row: toSnakeRow(r),
        owner: businessOwner(customerRelationship.supplierOrganizationId),
      };
    }
    case 'customer_relationships': {
      const r = await tx.customerRelationship.findUnique({ where: { id } });
      return r ? { row: toSnakeRow(r), owner: ownerOf(r) } : null;
    }
    case 'orders': {
      const found = await tx.order.findUnique({ where: { id }, include: withRelationship });
      if (!found) return null;
      const { customerRelationship, ...r } = found;
      return { row: toSnakeRow(r), owner: ownerOf(customerRelationship) };
    }
    case 'order_lines': {
      const found = await tx.orderLine.findUnique({ where: { id }, include: withOrder });
      if (!found) return null;
      const { order, ...r } = found;
      return { row: toSnakeRow(r), owner: ownerOf(order.customerRelationship) };
    }
    case 'deliveries': {
      const found = await tx.delivery.findUnique({ where: { id }, include: withOrder });
      if (!found) return null;
      const { order, ...r } = found;
      return { row: toSnakeRow(r), owner: ownerOf(order.customerRelationship) };
    }
    case 'ledger_entries': {
      const found = await tx.ledgerEntry.findUnique({ where: { id }, include: withRelationship });
      if (!found) return null;
      const { customerRelationship, ...r } = found;
      return { row: toSnakeRow(r), owner: ownerOf(customerRelationship) };
    }
    case 'notifications': {
      const r = await tx.notification.findUnique({ where: { id } });
      // A notification belongs to its recipient alone: the recipient stands for the owner person.
      return r
        ? { row: toSnakeRow(r), owner: { organizationId: null, customerPersonId: r.recipientId } }
        : null;
    }
  }
}

/** A flagged order or delivery, with the date the list sorts on. */
export type IssueRow = {
  table: 'orders' | 'deliveries';
  id: string;
  orderId: string;
  syncIssue: string;
  createdAt: Date;
};

type IssueViewer = {
  personId: string;
  memberships: Array<{ organizationId: string; role: CollaborationRole }>;
};

const suppliedBy = (organizationIds: string[]): Prisma.OrderWhereInput => ({
  deletedAt: null,
  customerRelationship: { is: { supplierOrganizationId: { in: organizationIds } } },
});

const NON_EMPTY_ISSUE = { not: null } as const;

/**
 * Reads, newest first (created_at descending then id), the orders and deliveries with a non-empty
 * `sync_issue` that the person may see (ASVS v5.0.0-8.2.2). Scope starts from the ACTIVE memberships
 * of the viewer: in an organization where they are OWNER every flagged record counts; in any other,
 * only the orders they entered or delivered and the deliveries assigned to them. A person with no
 * membership gets nothing. A delivery has no creation date of its own, so it sorts on its order's
 * (as the delivery list does). Each table is read up to `take` rows past the cursor; the caller
 * merges and trims.
 *
 * @param viewer - Person id and ACTIVE memberships, built from the database.
 * @param cursor - Last row of the previous page, or undefined for the first.
 * @param take - Rows to read from each table.
 */
export async function findIssueRows(
  viewer: IssueViewer,
  cursor: { createdAt: Date; id: string } | undefined,
  take: number
): Promise<IssueRow[]> {
  const memberOrgs = viewer.memberships.map((m) => m.organizationId);
  if (memberOrgs.length === 0) return [];
  const ownerOrgs = viewer.memberships
    .filter((m) => m.role === 'OWNER')
    .map((m) => m.organizationId);
  const ownerScope = ownerOrgs.length > 0 ? [suppliedBy(ownerOrgs)] : [];

  const orders = await prisma.order.findMany({
    where: {
      AND: [
        { syncIssue: NON_EMPTY_ISSUE },
        { NOT: { syncIssue: '' } },
        {
          OR: [
            ...ownerScope,
            {
              AND: [
                suppliedBy(memberOrgs),
                { OR: [{ enteredById: viewer.personId }, { deliveredById: viewer.personId }] },
              ],
            },
          ],
        },
        ...(cursor
          ? [
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    },
    select: { id: true, syncIssue: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take,
  });

  const deliveries = await prisma.delivery.findMany({
    where: {
      AND: [
        { deletedAt: null, syncIssue: NON_EMPTY_ISSUE },
        { NOT: { syncIssue: '' } },
        {
          OR: [
            ...ownerScope.map((order) => ({ order: { is: order } })),
            { assignedToId: viewer.personId, order: { is: suppliedBy(memberOrgs) } },
          ],
        },
        ...(cursor
          ? [
              {
                OR: [
                  { order: { is: { createdAt: { lt: cursor.createdAt } } } },
                  { order: { is: { createdAt: cursor.createdAt } }, id: { gt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    },
    select: { id: true, orderId: true, syncIssue: true, order: { select: { createdAt: true } } },
    orderBy: [{ order: { createdAt: 'desc' } }, { id: 'asc' }],
    take,
  });

  return [
    ...orders.map((o) => ({
      table: 'orders' as const,
      id: o.id,
      orderId: o.id,
      syncIssue: o.syncIssue ?? '',
      createdAt: o.createdAt,
    })),
    ...deliveries.map((d) => ({
      table: 'deliveries' as const,
      id: d.id,
      orderId: d.orderId,
      syncIssue: d.syncIssue ?? '',
      createdAt: d.order.createdAt,
    })),
  ];
}

/** A line of a flagged order with the price the server holds for it now. */
export type FlaggedLine = {
  quantity: Prisma.Decimal;
  unitPriceApplied: bigint;
  referencePrice: bigint;
  currentPrice: bigint;
};

/** An order of the organization flagged in `sync_issue`, with who entered and delivered it. */
export type FlaggedOrder = {
  syncIssue: string;
  enteredById: string;
  deliveredById: string | null;
  lines: FlaggedLine[];
};

/**
 * Reads the organization's orders created in the period that carry a non-empty `sync_issue`. The
 * organization is the supplier of the order's relationship, never a client value (ASVS
 * v5.0.0-8.2.2). Orders flagged `PRICE_CHANGED` come with their lines and the reference price the
 * server holds now; other orders carry no lines.
 *
 * @param organizationId - The caller's organization, from `loadActor`.
 * @param period - `from` inclusive, `toExclusive` exclusive.
 */
export async function findFlaggedOrders(
  organizationId: string,
  period: { from: Date; toExclusive: Date }
): Promise<FlaggedOrder[]> {
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      AND: [{ syncIssue: { not: null } }, { NOT: { syncIssue: '' } }],
      createdAt: { gte: period.from, lt: period.toExclusive },
      customerRelationship: { is: { supplierOrganizationId: organizationId } },
    },
    select: {
      customerRelationshipId: true,
      syncIssue: true,
      enteredById: true,
      deliveredById: true,
      lines: {
        where: { deletedAt: null },
        select: {
          productVariantId: true,
          quantity: true,
          unitPriceApplied: true,
          referencePrice: true,
        },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });

  return prisma.$transaction(async (tx) => {
    const flagged: FlaggedOrder[] = [];
    for (const order of orders) {
      const issue = order.syncIssue ?? '';
      const lines: FlaggedLine[] = [];
      if (issue.includes('PRICE_CHANGED:')) {
        for (const line of order.lines) {
          const current = await getReferencePrice(
            tx,
            order.customerRelationshipId,
            line.productVariantId
          );
          lines.push({
            quantity: line.quantity,
            unitPriceApplied: line.unitPriceApplied,
            referencePrice: line.referencePrice,
            currentPrice: current.price,
          });
        }
      }
      flagged.push({
        syncIssue: issue,
        enteredById: order.enteredById,
        deliveredById: order.deliveredById,
        lines,
      });
    }
    return flagged;
  });
}
