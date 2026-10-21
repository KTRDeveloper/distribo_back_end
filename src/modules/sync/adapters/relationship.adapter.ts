import type { CollaborationRole, Prisma } from '@prisma/client';
import {
  projectForCustomer,
  projectForDriver,
  projectForSupplier,
  type RelationshipRow,
} from '../../relationship/relationship.visibility.js';
import { classifyChanges, toEpoch } from '../sync.changes.js';
import { registerAdapter } from '../sync.registry.js';
import type { Row, SyncAdapter, Viewer } from '../sync.types.js';
import { refuseEveryLine } from './identity.adapter.js';
import { pushRelationships } from './relationship.push.js';

type Changes = { created: Row[]; updated: Row[]; deleted: string[] };

/** Roles that see a customer's whole supplier-side record; a DRIVER gets the reduced view. */
const SUPPLIER_VIEW_ROLES: CollaborationRole[] = ['OWNER', 'MANAGER', 'SELLER'];

const WITH_PARTIES = {
  customerPerson: true,
  customerOrganization: { select: { name: true, description: true } },
} satisfies Prisma.CustomerRelationshipInclude;

function organizationsWithRole(viewer: Viewer, roles: CollaborationRole[]): string[] {
  return viewer.memberships.filter((m) => roles.includes(m.role)).map((m) => m.organizationId);
}

/** A row merged into another is gone for the phone even if its deletion mark were missing. */
function isGone(row: { deletedAt: Date | null; mergedIntoId: string | null }): boolean {
  return row.deletedAt !== null || row.mergedIntoId !== null;
}

/**
 * The relationships a viewer may receive, as OR branches (ASVS v5.0.0-8.2.2). Scope comes from the
 * viewer's ACTIVE memberships and person id only. On a first pull gone rows are left out; on an
 * incremental pull they are kept so the phone learns their ids (AC-5).
 */
function scopeBranches(
  viewer: Viewer,
  since: Date | null
): Prisma.CustomerRelationshipWhereInput[] {
  const gone: Prisma.CustomerRelationshipWhereInput = {
    OR: [{ deletedAt: { not: null } }, { mergedIntoId: { not: null } }],
  };
  const live: Prisma.CustomerRelationshipWhereInput = { deletedAt: null, mergedIntoId: null };
  const state = since ? {} : live;

  const branches: Prisma.CustomerRelationshipWhereInput[] = [
    { customerPersonId: viewer.personId, ...state },
  ];
  const supplierOrgs = organizationsWithRole(viewer, SUPPLIER_VIEW_ROLES);
  if (supplierOrgs.length > 0) {
    branches.push({ supplierOrganizationId: { in: supplierOrgs }, ...state });
  }
  const driverOrgs = organizationsWithRole(viewer, ['DRIVER']);
  if (driverOrgs.length > 0) {
    branches.push({
      supplierOrganizationId: { in: driverOrgs },
      ...live,
      orders: {
        some: {
          status: 'CONFIRMED',
          deletedAt: null,
          OR: [
            { deliveryAddressApplied: { not: null } },
            { deliveries: { some: { assignedToId: viewer.personId, deletedAt: null } } },
          ],
        },
      },
    });
    if (since) branches.push({ supplierOrganizationId: { in: driverOrgs }, ...gone });
  }
  return branches;
}

function baseColumns(r: RelationshipRow & { serverUpdatedAt: Date }): Row {
  return {
    id: r.id,
    supplier_organization_id: r.supplierOrganizationId,
    customer_person_id: r.customerPersonId,
    customer_organization_id: r.customerOrganizationId,
    status: r.status,
    created_at: toEpoch(r.createdAt),
    server_updated_at: toEpoch(r.serverUpdatedAt),
  };
}

/**
 * Builds the row a phone receives, from the REL-005 projection that fits the viewer. A person who
 * is the customer of the row always gets the customer view, even when also a collaborator of the
 * supplier (nobody judges their own record). Explicit field lists only (ASVS v5.0.0-15.3.1).
 */
function toSyncRow(
  r: RelationshipRow & { serverUpdatedAt: Date },
  viewer: Viewer,
  supplierViewOrgs: Set<string>
): Row {
  if (r.customerPersonId === viewer.personId) {
    const v = projectForCustomer(r);
    return {
      ...baseColumns(r),
      supplier_person_id: r.supplierPersonId,
      supplier_label: v.supplier_label,
      delivery_address: v.delivery_address,
      credit_limit: v.credit_limit,
      balance: v.balance,
      ended_by_party: v.ended_by_party,
    };
  }
  if (r.supplierOrganizationId !== null && supplierViewOrgs.has(r.supplierOrganizationId)) {
    const v = projectForSupplier(r);
    return {
      ...baseColumns(r),
      customer_label: v.customer_label,
      supplier_notes: v.supplier_notes,
      delivery_address: v.delivery_address,
      credit_limit: v.credit_limit,
      credit_limit_set_by_id: v.credit_limit_set_by_id,
      credit_limit_set_at: v.credit_limit_set_at ? toEpoch(v.credit_limit_set_at) : null,
      balance: v.balance,
      ended_by_party: v.ended_by_party,
    };
  }
  // A driver: the available credit takes the place of the limit, the balance is zeroed (CM-30).
  const v = projectForDriver(r);
  return {
    ...baseColumns(r),
    customer_label: v.customer_name,
    credit_limit: v.available_credit,
    balance: 0,
  };
}

/**
 * `customer_relationships`: supplier view for OWNER, MANAGER and SELLER, the available credit only
 * for a DRIVER (and only for customers with a confirmed order to deliver), customer view for the
 * customer person. Deleted and merged rows are listed in `deleted` (C-35, CM-30, AC-5). Pushed
 * customers are created, merged and edited by `relationship.push.ts` (SYNC-011).
 */
export const customerRelationshipsAdapter: SyncAdapter = {
  table: 'customer_relationships',
  async pull(viewer, since, tx): Promise<Changes> {
    const rows = await tx.customerRelationship.findMany({
      where: {
        AND: [
          { OR: scopeBranches(viewer, since) },
          since ? { serverUpdatedAt: { gt: since } } : {},
        ],
      },
      include: WITH_PARTIES,
      orderBy: { id: 'asc' },
    });
    const supplierViewOrgs = new Set(organizationsWithRole(viewer, SUPPLIER_VIEW_ROLES));
    return classifyChanges(
      rows.map((r) => ({ ...r, deletedAt: isGone(r) ? (r.deletedAt ?? r.serverUpdatedAt) : null })),
      since,
      (r) => r.createdAt,
      (r) => toSyncRow(r, viewer, supplierViewOrgs)
    );
  },
  push: pushRelationships,
};

/**
 * `customer_prices`: the negotiated prices of the organization's customers for OWNER, MANAGER and
 * SELLER; a customer person receives only the prices of their own relationships; a DRIVER none.
 * `set_at` stands for `created_at`. Prices identify the sellable variant, never its legacy parent
 * (SYNC-027, ASVS v5.0.0-15.3.1); the database compatibility column is not part of the wire contract.
 */
export const customerPricesAdapter: SyncAdapter = {
  table: 'customer_prices',
  async pull(viewer, since, tx): Promise<Changes> {
    const supplierOrgs = organizationsWithRole(viewer, SUPPLIER_VIEW_ROLES);
    const relationship: Prisma.CustomerRelationshipWhereInput[] = [
      { customerPersonId: viewer.personId },
    ];
    if (supplierOrgs.length > 0)
      relationship.push({ supplierOrganizationId: { in: supplierOrgs } });

    const rows = await tx.customerPrice.findMany({
      where: {
        customerRelationship: {
          OR: relationship,
          ...(since ? {} : { deletedAt: null, mergedIntoId: null }),
        },
        ...(since ? { serverUpdatedAt: { gt: since } } : { deletedAt: null }),
      },
      select: {
        id: true,
        customerRelationshipId: true,
        productVariantId: true,
        price: true,
        setAt: true,
        serverUpdatedAt: true,
        deletedAt: true,
      },
      orderBy: { id: 'asc' },
    });
    return classifyChanges(
      rows,
      since,
      (r) => r.setAt,
      (r) => ({
        id: r.id,
        customer_relationship_id: r.customerRelationshipId,
        product_variant_id: r.productVariantId,
        price: Number(r.price),
        set_at: toEpoch(r.setAt),
        server_updated_at: toEpoch(r.serverUpdatedAt),
      })
    );
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

export const relationshipAdapters: SyncAdapter[] = [
  customerRelationshipsAdapter,
  customerPricesAdapter,
];

/** Registers the relationship adapters; called once when the sync routes are built. */
export function registerRelationshipAdapters(): void {
  for (const adapter of relationshipAdapters) registerAdapter(adapter);
}
