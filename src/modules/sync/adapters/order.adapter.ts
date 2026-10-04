import type { CollaborationRole, Delivery, Order, OrderLine, Prisma } from '@prisma/client';
import {
  projectOrderForCustomer,
  projectOrderForSupplier,
  type OrderLineView,
} from '../../order/order.views.js';
import { classifyChanges, toEpoch } from '../sync.changes.js';
import { registerAdapter } from '../sync.registry.js';
import type { Row, SyncAdapter, Viewer } from '../sync.types.js';
import { refuseEveryLine } from './identity.adapter.js';

type Changes = { created: Row[]; updated: Row[]; deleted: string[] };

/** Roles that see every order of the organization; a DRIVER gets a narrower scope. */
const SUPPLIER_VIEW_ROLES: CollaborationRole[] = ['OWNER', 'MANAGER', 'SELLER'];

/** Closed orders stay on the phone this long (CM-30). */
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const PARTIES = {
  select: { supplierOrganizationId: true, customerPersonId: true },
} satisfies Prisma.CustomerRelationshipDefaultArgs;

type Parties = { supplierOrganizationId: string | null; customerPersonId: string | null };
type OrderWithParties = Order & { customerRelationship: Parties };

function organizationsWithRole(viewer: Viewer, roles: CollaborationRole[]): string[] {
  return viewer.memberships.filter((m) => roles.includes(m.role)).map((m) => m.organizationId);
}

/** Open orders always; DELIVERED and CANCELLED ones only when closed within the retention window. */
function retention(): Prisma.OrderWhereInput {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
  return {
    OR: [
      { status: { in: ['PENDING', 'CONFIRMED', 'IN_DELIVERY'] } },
      { status: 'DELIVERED', deliveredAt: { gte: cutoff } },
      { status: 'CANCELLED', cancelledAt: { gte: cutoff } },
    ],
  };
}

/**
 * The orders a viewer may receive, as OR branches (ASVS v5.0.0-8.2.2). Scope starts from the
 * viewer's ACTIVE memberships and person id only: the customer branch, the supplier-view branch
 * and the driver branch (the delivery pool, orders they delivered, orders with their deliveries).
 * Live rows must be within the retention window; with `includeGone` the soft-deleted rows of the
 * same parties are added so an incremental pull can list their ids (C-35).
 */
function orderScope(viewer: Viewer, includeGone: boolean): Prisma.OrderWhereInput {
  const parties: Array<{ base: Prisma.OrderWhereInput; narrow?: Prisma.OrderWhereInput }> = [
    { base: { customerRelationship: { customerPersonId: viewer.personId } } },
  ];
  const supplierOrgs = organizationsWithRole(viewer, SUPPLIER_VIEW_ROLES);
  if (supplierOrgs.length > 0) {
    parties.push({
      base: { customerRelationship: { supplierOrganizationId: { in: supplierOrgs } } },
    });
  }
  const driverOrgs = organizationsWithRole(viewer, ['DRIVER']);
  if (driverOrgs.length > 0) {
    parties.push({
      base: { customerRelationship: { supplierOrganizationId: { in: driverOrgs } } },
      narrow: {
        OR: [
          { status: 'CONFIRMED', deliveryAddressApplied: { not: null } },
          { status: 'IN_DELIVERY' },
          { deliveredById: viewer.personId },
          { deliveries: { some: { assignedToId: viewer.personId, deletedAt: null } } },
        ],
      },
    });
  }
  const branches: Prisma.OrderWhereInput[] = parties.map(({ base, narrow }) => ({
    AND: [base, narrow ?? {}, { deletedAt: null }, retention()],
  }));
  if (includeGone) {
    for (const { base } of parties) branches.push({ AND: [base, { deletedAt: { not: null } }] });
  }
  return { OR: branches };
}

/**
 * The view a viewer gets of one order's party: a person who is the customer of the relationship
 * always gets the customer view, even when also a collaborator of the supplier. Any other viewer
 * must hold a role in the supplier organization; none means the row is dropped (fail closed).
 */
function roleOf(parties: Parties, viewer: Viewer): CollaborationRole | 'CUSTOMER' | null {
  if (parties.customerPersonId === viewer.personId) return 'CUSTOMER';
  const membership = viewer.memberships.find(
    (m) => m.organizationId === parties.supplierOrganizationId
  );
  return membership?.role ?? null;
}

function lineRow(view: OrderLineView, line: OrderLine): Row {
  const { price_set_at: priceSetAt, ...rest } = view;
  return {
    ...rest,
    order_id: line.orderId,
    ...(priceSetAt === undefined
      ? {}
      : { price_set_at: line.priceSetAt ? toEpoch(line.priceSetAt) : null }),
    server_updated_at: toEpoch(line.serverUpdatedAt),
  };
}

/**
 * Builds the order row a phone receives from the ORD-007 projection that fits the viewer
 * (ASVS v5.0.0-8.2.3, v5.0.0-15.3.1): supplier view with `sync_issue` for OWNER, MANAGER and
 * SELLER, the same without `sync_issue` for a DRIVER, the customer view for the customer.
 * Timestamps become epoch milliseconds; the lines travel in `order_lines`.
 */
function orderRow(order: OrderWithParties, viewer: Viewer): Row | null {
  const role = roleOf(order.customerRelationship, viewer);
  if (role === null) return null;
  const withoutLines = { ...order, lines: [] };
  const view: Row =
    role === 'CUSTOMER'
      ? { ...projectOrderForCustomer(withoutLines) }
      : { ...projectOrderForSupplier(withoutLines, role) };
  delete view['lines'];
  if (role === 'DRIVER') delete view['sync_issue'];
  return {
    ...view,
    created_at: toEpoch(order.createdAt),
    delivered_at: order.deliveredAt ? toEpoch(order.deliveredAt) : null,
    cancelled_at: order.cancelledAt ? toEpoch(order.cancelledAt) : null,
    server_updated_at: toEpoch(order.serverUpdatedAt),
  };
}

/**
 * `orders`: supplier view for OWNER, MANAGER and SELLER (with `sync_issue`); for a DRIVER the
 * confirmed orders with an address, the orders in delivery, the orders they delivered and those
 * carrying their deliveries, without `sync_issue`; the customer view for the customer person.
 * Open orders always, closed ones of the last 90 days (CM-30). Deleted rows are listed in
 * `deleted` (C-35).
 */
export const ordersAdapter: SyncAdapter = {
  table: 'orders',
  async pull(viewer, since, tx): Promise<Changes> {
    const rows = await tx.order.findMany({
      where: {
        AND: [orderScope(viewer, since !== null), since ? { serverUpdatedAt: { gt: since } } : {}],
      },
      include: { customerRelationship: PARTIES },
      orderBy: { id: 'asc' },
    });
    const allowed = rows.filter((r) => roleOf(r.customerRelationship, viewer) !== null);
    return classifyChanges(
      allowed,
      since,
      (r) => r.createdAt,
      (r) => orderRow(r, viewer) ?? {}
    );
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

/**
 * `order_lines`: the lines of the orders the viewer receives, in the same view. A line is sent
 * when it changed or when its order changed, so an updated order always arrives with its lines
 * (AC-4); a deleted line is listed in `deleted` (C-35).
 */
export const orderLinesAdapter: SyncAdapter = {
  table: 'order_lines',
  async pull(viewer, since, tx): Promise<Changes> {
    const rows = await tx.orderLine.findMany({
      where: {
        order: orderScope(viewer, false),
        ...(since
          ? {
              OR: [
                { serverUpdatedAt: { gt: since } },
                { order: { serverUpdatedAt: { gt: since } } },
              ],
            }
          : { deletedAt: null }),
      },
      include: { order: { include: { customerRelationship: PARTIES } } },
      orderBy: { id: 'asc' },
    });
    const allowed = rows.filter((r) => roleOf(r.order.customerRelationship, viewer) !== null);
    return classifyChanges(
      // A line travels with its order: its order's change counts as the line's change.
      allowed.map((r) => ({
        ...r,
        serverUpdatedAt:
          r.deletedAt === null && r.order.serverUpdatedAt > r.serverUpdatedAt
            ? r.order.serverUpdatedAt
            : r.serverUpdatedAt,
      })),
      since,
      (r) => r.order.createdAt,
      (r) => {
        const role = roleOf(r.order.customerRelationship, viewer);
        const { order, ...line } = r;
        const view =
          role === 'CUSTOMER' || role === null
            ? projectOrderForCustomer({ ...order, lines: [line] })
            : projectOrderForSupplier({ ...order, lines: [line] }, role);
        return lineRow(view.lines[0], line);
      }
    );
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

function deliveryRow(d: Delivery): Row {
  return {
    id: d.id,
    order_id: d.orderId,
    assigned_to_id: d.assignedToId,
    departed_at: d.departedAt ? toEpoch(d.departedAt) : null,
    arrived_at: d.arrivedAt ? toEpoch(d.arrivedAt) : null,
    failed_at: d.failedAt ? toEpoch(d.failedAt) : null,
    failure_reason: d.failureReason,
    sync_issue: d.syncIssue,
    server_updated_at: toEpoch(d.serverUpdatedAt),
  };
}

/**
 * `deliveries`: every delivery of the organization's orders for OWNER, MANAGER and SELLER; only
 * their own deliveries for a DRIVER; none for a customer person (fail closed). Deliveries follow
 * their order's retention. There is no `created_at` column: the first attempt is `created` on a
 * first pull, later changes are `updated`.
 */
export const deliveriesAdapter: SyncAdapter = {
  table: 'deliveries',
  async pull(viewer, since, tx): Promise<Changes> {
    const supplierOrgs = organizationsWithRole(viewer, SUPPLIER_VIEW_ROLES);
    const driverOrgs = organizationsWithRole(viewer, ['DRIVER']);
    const parties: Prisma.DeliveryWhereInput[] = [];
    if (supplierOrgs.length > 0) {
      parties.push({
        order: { customerRelationship: { supplierOrganizationId: { in: supplierOrgs } } },
      });
    }
    if (driverOrgs.length > 0) {
      parties.push({
        assignedToId: viewer.personId,
        order: { customerRelationship: { supplierOrganizationId: { in: driverOrgs } } },
      });
    }
    if (parties.length === 0) return { created: [], updated: [], deleted: [] };

    const live: Prisma.DeliveryWhereInput = {
      deletedAt: null,
      order: { deletedAt: null, ...retention() },
    };
    const rows = await tx.delivery.findMany({
      where: {
        AND: [
          { OR: parties },
          since ? { OR: [live, { deletedAt: { not: null } }] } : live,
          since ? { serverUpdatedAt: { gt: since } } : {},
        ],
      },
      orderBy: { id: 'asc' },
    });
    // No creation column: a delivery is `created` on a first pull and `updated` afterwards.
    return classifyChanges(rows, since, () => new Date(0), deliveryRow);
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

export const orderAdapters: SyncAdapter[] = [ordersAdapter, orderLinesAdapter, deliveriesAdapter];

/** Registers the order adapters; called once when the sync routes are built. */
export function registerOrderAdapters(): void {
  for (const adapter of orderAdapters) registerAdapter(adapter);
}
