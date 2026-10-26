import type { CollaborationRole, Prisma } from '@prisma/client';
import { imageUrl } from '../../../lib/image-keys.js';
import { classifyChanges, toEpoch } from '../sync.changes.js';
import { registerAdapter } from '../sync.registry.js';
import type { Row, SyncAdapter, Viewer } from '../sync.types.js';
import { refuseEveryLine } from './identity.adapter.js';

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

/**
 * The products a viewer may receive, as OR branches (ASVS v5.0.0-8.2.2). Scope comes from the
 * viewer's ACTIVE memberships only. A customer person has no branch at all: they browse online.
 * For a driver the scope walks from the visible line to its variant and to the variant's product.
 * A product the driver newly sees because an order line appeared or its order changed is sent
 * even if the product row itself did not change, so it is never missing on the phone.
 */
function scopeBranches(viewer: Viewer, since: Date | null): Prisma.ProductWhereInput[] {
  const branches: Prisma.ProductWhereInput[] = [];

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
 * for the catalog roles, and for a driver only the variants named by a visible line, whatever
 * their status, with the same incremental rule as the products.
 */
function variantScopeBranches(
  viewer: Viewer,
  since: Date | null
): Prisma.ProductVariantWhereInput[] {
  const branches: Prisma.ProductVariantWhereInput[] = [];

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
 * for a DRIVER (ASVS v5.0.0-15.3.1); nothing for a customer person (C-35, CM-30). Photos go out as
 * addresses, never as keys.
 */
export const productsAdapter: SyncAdapter = {
  table: 'products',
  async pull(viewer, since, tx): Promise<Changes> {
    const branches = scopeBranches(viewer, since);
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
      },
      orderBy: { id: 'asc' },
    });
    const catalogOrgs = new Set(organizationsWithRole(viewer, CATALOG_ROLES));
    return classifyChanges(
      rows,
      since,
      (r) => r.createdAt,
      (r): Row =>
        catalogOrgs.has(r.organizationId)
          ? {
              id: r.id,
              organization_id: r.organizationId,
              name: r.name,
              description: r.description,
              category: r.category,
              image_urls: r.imageKeys.map((key) => imageUrl(key)!),
              paused_at: r.pausedAt ? toEpoch(r.pausedAt) : null,
              created_at: toEpoch(r.createdAt),
              server_updated_at: toEpoch(r.serverUpdatedAt),
            }
          : { id: r.id, name: r.name }
    );
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

/**
 * `product_variants`: every variant of the organization (any status) for OWNER, MANAGER and
 * SELLER; a deleted or merged one is listed in `deleted` (C-35). A DRIVER receives only the
 * variants named by lines of orders they may see, as `id, product_id, name, unit`, even when the
 * variant is INACTIVE or its product paused (ASVS v5.0.0-8.2.2, v5.0.0-15.3.1, CM-30). No customer
 * person receives any. A variant change moves its product too, by a database trigger (CM-42), so
 * both always arrive together. `min_order_quantity` is a decimal string, like the catalog API.
 */
export const variantsAdapter: SyncAdapter = {
  table: 'product_variants',
  async pull(viewer, since, tx): Promise<Changes> {
    const branches = variantScopeBranches(viewer, since);
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
      },
      orderBy: { id: 'asc' },
    });
    const catalogOrgs = new Set(organizationsWithRole(viewer, CATALOG_ROLES));
    return classifyChanges(
      rows,
      since,
      (r) => r.createdAt,
      (r): Row =>
        catalogOrgs.has(r.organizationId)
          ? {
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
            }
          : { id: r.id, product_id: r.productId, name: r.name, unit: r.unit }
    );
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

export const catalogAdapters: SyncAdapter[] = [productsAdapter, variantsAdapter];

/** Registers the catalog adapters; called once when the sync routes are built. */
export function registerCatalogAdapters(): void {
  for (const adapter of catalogAdapters) registerAdapter(adapter);
}
