import type { CollaborationRole, Prisma } from '@prisma/client';
import { imageUrl } from '../../../lib/image-keys.js';
import { classifyChanges, toEpoch } from '../sync.changes.js';
import { registerAdapter } from '../sync.registry.js';
import type { Row, SyncAdapter, Viewer } from '../sync.types.js';
import { pushProducts, pushVariants } from './catalog.push.js';

type Changes = { created: Row[]; updated: Row[]; deleted: string[] };

/** Roles that receive the whole catalog of their organization; a DRIVER gets names only. */
const CATALOG_ROLES: CollaborationRole[] = ['OWNER', 'MANAGER', 'SELLER'];

function organizationsWithRole(viewer: Viewer, roles: CollaborationRole[]): string[] {
  return viewer.memberships.filter((m) => roles.includes(m.role)).map((m) => m.organizationId);
}

/**
 * The order lines a driver may know about: lines of CONFIRMED or IN_DELIVERY orders that have a
 * delivery address or are assigned to the driver (the same pool as the relationships they see).
 */
function driverVisibleLines(viewer: Viewer): Prisma.OrderLineWhereInput {
  return {
    deletedAt: null,
    order: {
      deletedAt: null,
      status: { in: ['CONFIRMED', 'IN_DELIVERY'] },
      OR: [
        { deliveryAddressApplied: { not: null } },
        { deliveries: { some: { assignedToId: viewer.personId, deletedAt: null } } },
      ],
    },
  };
}

/** A visible line that changed since the last pull, or whose order changed. */
function changedVisibleLine(viewer: Viewer, since: Date): Prisma.OrderLineWhereInput {
  return {
    ...driverVisibleLines(viewer),
    OR: [{ serverUpdatedAt: { gt: since } }, { order: { serverUpdatedAt: { gt: since } } }],
  };
}

/** A variant a customer may buy: live and ACTIVE. */
const ACTIVE_LIVE_VARIANT = { deletedAt: null, status: 'ACTIVE' } as const;

/**
 * The suppliers whose catalog a customer person receives (ASVS v5.0.0-8.2.2): those with whom the
 * viewer holds a live relationship (ACTIVE, not deleted, not merged) and whose business is ACTIVE.
 * Organizations where the viewer holds a membership are left out: their staff view already applies,
 * so a collaborator never gets a second, narrower shape for the same rows. `fresh` are the
 * suppliers whose relationship changed since the last pull, e.g. a connection made after it: their
 * whole catalog on sale is sent again, since none of its rows changed to trigger it.
 */
async function customerScope(
  viewer: Viewer,
  since: Date | null,
  tx: Prisma.TransactionClient
): Promise<{ orgs: string[]; fresh: string[] }> {
  const relationships = await tx.customerRelationship.findMany({
    where: {
      customerPersonId: viewer.personId,
      status: 'ACTIVE',
      deletedAt: null,
      mergedIntoId: null,
      supplierOrganization: { status: 'ACTIVE', deletedAt: null },
    },
    select: { supplierOrganizationId: true, serverUpdatedAt: true },
  });
  const staff = new Set(viewer.memberships.map((m) => m.organizationId));
  const orgs = new Set<string>();
  const fresh = new Set<string>();
  for (const r of relationships) {
    const org = r.supplierOrganizationId;
    if (org === null || staff.has(org)) continue;
    orgs.add(org);
    if (since !== null && r.serverUpdatedAt > since) fresh.add(org);
  }
  return { orgs: [...orgs], fresh: [...fresh] };
}

/** The product rows of the suppliers a customer buys from, as OR branches (C-46, CM-42). */
function customerProductBranches(
  scope: { orgs: string[]; fresh: string[] },
  since: Date | null
): Prisma.ProductWhereInput[] {
  const onSale: Prisma.ProductWhereInput = {
    deletedAt: null,
    pausedAt: null,
    variants: { some: ACTIVE_LIVE_VARIANT },
  };
  if (scope.orgs.length === 0) return [];
  // A product that left the sale is read too, on an incremental pull, to be announced in `deleted`.
  if (since === null) return [{ organizationId: { in: scope.orgs }, ...onSale }];
  const branches: Prisma.ProductWhereInput[] = [
    { organizationId: { in: scope.orgs }, serverUpdatedAt: { gt: since } },
  ];
  if (scope.fresh.length > 0) branches.push({ organizationId: { in: scope.fresh }, ...onSale });
  return branches;
}

/** The variant rows of the suppliers a customer buys from; a product change moves its variants. */
function customerVariantBranches(
  scope: { orgs: string[]; fresh: string[] },
  since: Date | null
): Prisma.ProductVariantWhereInput[] {
  const sellable: Prisma.ProductVariantWhereInput = {
    ...ACTIVE_LIVE_VARIANT,
    product: { deletedAt: null, pausedAt: null },
  };
  if (scope.orgs.length === 0) return [];
  if (since === null) return [{ organizationId: { in: scope.orgs }, ...sellable }];
  const branches: Prisma.ProductVariantWhereInput[] = [
    {
      organizationId: { in: scope.orgs },
      OR: [{ serverUpdatedAt: { gt: since } }, { product: { serverUpdatedAt: { gt: since } } }],
    },
  ];
  if (scope.fresh.length > 0) branches.push({ organizationId: { in: scope.fresh }, ...sellable });
  return branches;
}

/**
 * The products a viewer may receive, as OR branches (ASVS v5.0.0-8.2.2). Scope comes from the
 * viewer's ACTIVE memberships, plus, for a customer person, the suppliers they buy from (SYNC-026).
 * For a driver the scope walks from the visible line to its variant and to the variant's product.
 * A product the driver newly sees because an order line appeared or its order changed is sent
 * even if the product row itself did not change, so it is never missing on the phone.
 */
function scopeBranches(
  viewer: Viewer,
  since: Date | null,
  customer: { orgs: string[]; fresh: string[] }
): Prisma.ProductWhereInput[] {
  const branches: Prisma.ProductWhereInput[] = customerProductBranches(customer, since);

  const catalogOrgs = organizationsWithRole(viewer, CATALOG_ROLES);
  if (catalogOrgs.length > 0) {
    branches.push({
      organizationId: { in: catalogOrgs },
      ...(since ? { serverUpdatedAt: { gt: since } } : { deletedAt: null }),
    });
  }

  const driverOrgs = organizationsWithRole(viewer, ['DRIVER']);
  if (driverOrgs.length > 0) {
    const named = { variants: { some: { orderLines: { some: driverVisibleLines(viewer) } } } };
    if (since === null) {
      branches.push({ organizationId: { in: driverOrgs }, deletedAt: null, ...named });
    } else {
      branches.push({
        organizationId: { in: driverOrgs },
        deletedAt: null,
        ...named,
        OR: [
          { serverUpdatedAt: { gt: since } },
          { variants: { some: { orderLines: { some: changedVisibleLine(viewer, since) } } } },
        ],
      });
      // A deleted product is announced by id only, and only if some order line still names it.
      branches.push({
        organizationId: { in: driverOrgs },
        deletedAt: { not: null },
        serverUpdatedAt: { gt: since },
        variants: { some: { orderLines: { some: {} } } },
      });
    }
  }
  return branches;
}

/**
 * The variants a viewer may receive, as OR branches (ASVS v5.0.0-8.2.2): the whole organization
 * for the catalog roles, the ACTIVE variants on sale for a customer, and for a driver only the variants named by a visible line, whatever
 * their status, with the same incremental rule as the products.
 */
function variantScopeBranches(
  viewer: Viewer,
  since: Date | null,
  customer: { orgs: string[]; fresh: string[] }
): Prisma.ProductVariantWhereInput[] {
  const branches: Prisma.ProductVariantWhereInput[] = customerVariantBranches(customer, since);

  const catalogOrgs = organizationsWithRole(viewer, CATALOG_ROLES);
  if (catalogOrgs.length > 0) {
    branches.push({
      organizationId: { in: catalogOrgs },
      ...(since ? { serverUpdatedAt: { gt: since } } : { deletedAt: null }),
    });
  }

  const driverOrgs = organizationsWithRole(viewer, ['DRIVER']);
  if (driverOrgs.length > 0) {
    const named = { orderLines: { some: driverVisibleLines(viewer) } };
    if (since === null) {
      branches.push({ organizationId: { in: driverOrgs }, deletedAt: null, ...named });
    } else {
      branches.push({
        organizationId: { in: driverOrgs },
        deletedAt: null,
        ...named,
        OR: [
          { serverUpdatedAt: { gt: since } },
          { orderLines: { some: changedVisibleLine(viewer, since) } },
        ],
      });
      // A deleted variant is announced by id only, and only if some order line still names it.
      branches.push({
        organizationId: { in: driverOrgs },
        deletedAt: { not: null },
        serverUpdatedAt: { gt: since },
        orderLines: { some: {} },
      });
    }
  }
  return branches;
}

/**
 * `products`: the whole catalog of the organization for OWNER, MANAGER and SELLER (paused ones
 * included, with `paused_at`; deleted rows in `deleted`), without price, unit or status: those
 * belong to the variants (SYNC-024). `id, name` of the products named by lines of orders to deliver
 * for a DRIVER (ASVS v5.0.0-15.3.1); Photos go out as
 * addresses, never as keys. A customer person receives the products on sale of the suppliers they
 * hold a live relationship with: `id, organization_id, name, description, category, image_urls`;
 * one that left the sale (deleted, paused, no ACTIVE variant) is listed in `deleted` (SYNC-026,
 * C-46, ASVS v5.0.0-15.3.1: no pause date, status or photo key). Push: the OWNER's created and
 * edited products, name, description and category only (SYNC-031, `catalog.push.ts`).
 */
export const productsAdapter: SyncAdapter = {
  table: 'products',
  async pull(viewer, since, tx): Promise<Changes> {
    const customer = await customerScope(viewer, since, tx);
    const branches = scopeBranches(viewer, since, customer);
    if (branches.length === 0) return { created: [], updated: [], deleted: [] };

    const rows = await tx.product.findMany({
      where: { OR: branches },
      select: {
        id: true,
        organizationId: true,
        name: true,
        description: true,
        category: true,
        imageKeys: true,
        pausedAt: true,
        createdAt: true,
        serverUpdatedAt: true,
        deletedAt: true,
        variants: { where: ACTIVE_LIVE_VARIANT, select: { id: true }, take: 1 },
      },
      orderBy: { id: 'asc' },
    });
    const catalogOrgs = new Set(organizationsWithRole(viewer, CATALOG_ROLES));
    const customerOrgs = new Set(customer.orgs);
    // A customer's product that left the sale is announced as deleted, so the phone drops it (AC-4).
    const seen = rows.map((r) =>
      customerOrgs.has(r.organizationId) &&
      (r.deletedAt !== null || r.pausedAt !== null || r.variants.length === 0)
        ? { ...r, deletedAt: r.deletedAt ?? r.serverUpdatedAt }
        : r
    );
    return classifyChanges(
      seen,
      since,
      (r) => r.createdAt,
      (r): Row => {
        if (catalogOrgs.has(r.organizationId)) {
          return {
            id: r.id,
            organization_id: r.organizationId,
            name: r.name,
            description: r.description,
            category: r.category,
            image_urls: r.imageKeys.map((key) => imageUrl(key)!),
            paused_at: r.pausedAt ? toEpoch(r.pausedAt) : null,
            created_at: toEpoch(r.createdAt),
            server_updated_at: toEpoch(r.serverUpdatedAt),
          };
        }
        if (customerOrgs.has(r.organizationId)) {
          return {
            id: r.id,
            organization_id: r.organizationId,
            name: r.name,
            description: r.description,
            category: r.category,
            image_urls: r.imageKeys.map((key) => imageUrl(key)!),
          };
        }
        return { id: r.id, name: r.name };
      }
    );
  },
  push: pushProducts,
};

/**
 * `product_variants`: every variant of the organization (any status) for OWNER, MANAGER and
 * SELLER; a deleted or merged one is listed in `deleted` (C-35). A DRIVER receives only the
 * variants named by lines of orders they may see, as `id, product_id, name, unit`, even when the
 * variant is INACTIVE or its product paused (ASVS v5.0.0-8.2.2, v5.0.0-15.3.1, CM-30). A customer
 * person receives the ACTIVE variants on sale of their suppliers, as `id, product_id,
 * organization_id, name, unit, price, min_order_quantity, image_urls`, and the ids of those that
 * left the sale in `deleted` (SYNC-026); their negotiated prices come from `customer_prices`. A variant change moves its product too, by a database trigger (CM-42), so
 * both always arrive together. `min_order_quantity` is a decimal string, like the catalog API.
 * Push: the OWNER's created and edited variants (SYNC-032, `catalog.push.ts`).
 */
export const variantsAdapter: SyncAdapter = {
  table: 'product_variants',
  async pull(viewer, since, tx): Promise<Changes> {
    const customer = await customerScope(viewer, since, tx);
    const branches = variantScopeBranches(viewer, since, customer);
    if (branches.length === 0) return { created: [], updated: [], deleted: [] };

    const rows = await tx.productVariant.findMany({
      where: { OR: branches },
      select: {
        id: true,
        productId: true,
        organizationId: true,
        name: true,
        unit: true,
        price: true,
        priceUpdatedAt: true,
        minOrderQuantity: true,
        status: true,
        imageKeys: true,
        createdAt: true,
        serverUpdatedAt: true,
        deletedAt: true,
        product: { select: { deletedAt: true, pausedAt: true, serverUpdatedAt: true } },
      },
      orderBy: { id: 'asc' },
    });
    const catalogOrgs = new Set(organizationsWithRole(viewer, CATALOG_ROLES));
    const customerOrgs = new Set(customer.orgs);
    // A customer's variant moves with its product (CM-42); one that is withdrawn, or whose product
    // left the sale, is announced as deleted (AC-4).
    const seen = rows.map((r) => {
      if (!customerOrgs.has(r.organizationId)) return r;
      const changedAt =
        r.product.serverUpdatedAt > r.serverUpdatedAt
          ? r.product.serverUpdatedAt
          : r.serverUpdatedAt;
      const onSale =
        r.deletedAt === null &&
        r.status === 'ACTIVE' &&
        r.product.deletedAt === null &&
        r.product.pausedAt === null;
      return {
        ...r,
        serverUpdatedAt: changedAt,
        deletedAt: onSale ? null : (r.deletedAt ?? changedAt),
      };
    });
    return classifyChanges(
      seen,
      since,
      (r) => r.createdAt,
      (r): Row => {
        if (catalogOrgs.has(r.organizationId)) {
          return {
            id: r.id,
            product_id: r.productId,
            organization_id: r.organizationId,
            name: r.name,
            unit: r.unit,
            price: Number(r.price),
            price_updated_at: toEpoch(r.priceUpdatedAt),
            min_order_quantity: r.minOrderQuantity?.toString() ?? null,
            status: r.status,
            image_urls: r.imageKeys.map((key) => imageUrl(key)!),
            created_at: toEpoch(r.createdAt),
            server_updated_at: toEpoch(r.serverUpdatedAt),
          };
        }
        if (customerOrgs.has(r.organizationId)) {
          return {
            id: r.id,
            product_id: r.productId,
            organization_id: r.organizationId,
            name: r.name,
            unit: r.unit,
            price: Number(r.price),
            min_order_quantity: r.minOrderQuantity?.toString() ?? null,
            image_urls: r.imageKeys.map((key) => imageUrl(key)!),
          };
        }
        return { id: r.id, product_id: r.productId, name: r.name, unit: r.unit };
      }
    );
  },
  push: pushVariants,
};

export const catalogAdapters: SyncAdapter[] = [productsAdapter, variantsAdapter];

/** Registers the catalog adapters; called once when the sync routes are built. */
export function registerCatalogAdapters(): void {
  for (const adapter of catalogAdapters) registerAdapter(adapter);
}
