import type { Prisma } from '@prisma/client';
import { visibleRelationsWhere } from '../../relationship/relationship.visibility.js';
import { classifyChanges, toEpoch } from '../sync.changes.js';
import { registerAdapter } from '../sync.registry.js';
import type { LineOutcome, Row, SyncAdapter, TableChange, Viewer } from '../sync.types.js';

type Changes = { created: Row[]; updated: Row[]; deleted: string[] };

/** The viewer's ACTIVE organizations: the starting point of every adapter (ASVS v5.0.0-8.2.2). */
function organizationIdsOf(viewer: Viewer): string[] {
  return viewer.memberships.map((m) => m.organizationId);
}

/** Identity tables are read-only from a phone for now: every pushed line is forbidden (fail closed). */
export function refuseEveryLine(change: TableChange): LineOutcome[] {
  return [...change.created, ...change.updated]
    .map((row) => (typeof row['id'] === 'string' ? row['id'] : ''))
    .concat(change.deleted)
    .map((id) => ({
      table: change.table,
      id,
      kind: 'forbidden' as const,
      code: 'SYNC_TABLE_READ_ONLY',
      message: 'This table cannot be changed from a phone',
    }));
}

/**
 * `organizations`: the viewer's ACTIVE organizations, excluding the retired email (ORG-039).
 * Each row carries the plan, its due date, the grace end, the limits and the payment code (SYNC-037):
 * set by the server only (push stays refused) and sent to the team of the business only, since the
 * query never returns an organization the viewer is not an ACTIVE member of (C-41, v5.0.0-8.2.2).
 * The fields join an explicit list; no whole row is serialized (v5.0.0-15.3.1).
 */
export const organizationsAdapter: SyncAdapter = {
  table: 'organizations',
  async pull(viewer, since, tx): Promise<Changes> {
    const rows = await tx.organization.findMany({
      where: {
        id: { in: organizationIdsOf(viewer) },
        ...(since ? { serverUpdatedAt: { gt: since } } : { deletedAt: null }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        paymentCode: true,
        plan: true,
        planEndsAt: true,
        graceEndsAt: true,
        maxCollaborators: true,
        maxProducts: true,
        createdAt: true,
        serverUpdatedAt: true,
        deletedAt: true,
      },
      orderBy: { id: 'asc' },
    });
    return classifyChanges(
      rows,
      since,
      (r) => r.createdAt,
      (r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        status: r.status,
        payment_code: r.paymentCode,
        plan: r.plan,
        plan_ends_at: r.planEndsAt ? toEpoch(r.planEndsAt) : null,
        grace_ends_at: r.graceEndsAt ? toEpoch(r.graceEndsAt) : null,
        max_collaborators: r.maxCollaborators,
        max_products: r.maxProducts,
        created_at: toEpoch(r.createdAt),
        server_updated_at: toEpoch(r.serverUpdatedAt),
      })
    );
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

/**
 * `collaborations`: the rows of the viewer's organizations. `amount_held` is sent only on the
 * viewer's own row and to an OWNER of that organization; elsewhere the key is absent (CM-30).
 * `invited_at` stands for `created_at`, which this table does not have.
 * The retired public-contact flag is neither selected nor sent (ORG-039).
 */
export const collaborationsAdapter: SyncAdapter = {
  table: 'collaborations',
  async pull(viewer, since, tx): Promise<Changes> {
    const rows = await tx.collaboration.findMany({
      where: {
        organizationId: { in: organizationIdsOf(viewer) },
        ...(since ? { serverUpdatedAt: { gt: since } } : { deletedAt: null }),
      },
      select: {
        id: true,
        personId: true,
        organizationId: true,
        role: true,
        status: true,
        invitedAt: true,
        acceptedAt: true,
        amountHeld: true,
        serverUpdatedAt: true,
        deletedAt: true,
      },
      orderBy: { id: 'asc' },
    });
    const ownedOrganizations = new Set(
      viewer.memberships.filter((m) => m.role === 'OWNER').map((m) => m.organizationId)
    );
    return classifyChanges(
      rows,
      since,
      (r) => r.invitedAt,
      (r) => {
        const row: Row = {
          id: r.id,
          person_id: r.personId,
          organization_id: r.organizationId,
          role: r.role,
          status: r.status,
          invited_at: toEpoch(r.invitedAt),
          accepted_at: r.acceptedAt ? toEpoch(r.acceptedAt) : null,
          server_updated_at: toEpoch(r.serverUpdatedAt),
        };
        if (r.personId === viewer.personId || ownedOrganizations.has(r.organizationId)) {
          row['amount_held'] = Number(r.amountHeld);
        }
        return row;
      }
    );
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

/**
 * `people`: only the public fields `id, full_name, phone_number` of the people who appear in the
 * viewer's collaborations and visible relationships, and of the viewer. A person is sent when their
 * own row changed or when the link that makes them visible (collaboration or relationship) was created since the last pull, so a person
 * who just became visible is never missing on the phone. No dates are sent (AB-2).
 */
export const peopleAdapter: SyncAdapter = {
  table: 'people',
  async pull(viewer, since, tx): Promise<Changes> {
    const organizationIds = organizationIdsOf(viewer);
    const [collaborations, relationships] = await Promise.all([
      tx.collaboration.findMany({
        where: { organizationId: { in: organizationIds }, deletedAt: null },
        select: { personId: true, invitedAt: true },
      }),
      tx.customerRelationship.findMany({
        where: visibleRelationsWhere({ personId: viewer.personId, organizationIds }),
        select: { supplierPersonId: true, customerPersonId: true, createdAt: true },
      }),
    ]);

    const visible = new Set<string>([viewer.personId]);
    const linkChanged = new Set<string>();
    const note = (personId: string | null, linkedAt: Date) => {
      if (personId === null) return;
      visible.add(personId);
      if (since && linkedAt > since) linkChanged.add(personId);
    };
    for (const c of collaborations) note(c.personId, c.invitedAt);
    for (const r of relationships) {
      note(r.supplierPersonId, r.createdAt);
      note(r.customerPersonId, r.createdAt);
    }

    const where: Prisma.PersonWhereInput = since
      ? {
          id: { in: [...visible] },
          OR: [{ serverUpdatedAt: { gt: since } }, { id: { in: [...linkChanged] } }],
        }
      : { id: { in: [...visible] } };
    const people = await tx.person.findMany({
      where,
      select: { id: true, fullName: true, phoneNumber: true, createdAt: true },
      orderBy: { id: 'asc' },
    });

    const result: Changes = { created: [], updated: [], deleted: [] };
    for (const p of people) {
      const row: Row = { id: p.id, full_name: p.fullName, phone_number: p.phoneNumber };
      if (since === null || p.createdAt > since) result.created.push(row);
      else result.updated.push(row);
    }
    return result;
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

export const identityAdapters: SyncAdapter[] = [
  organizationsAdapter,
  collaborationsAdapter,
  peopleAdapter,
];

/** Registers the identity adapters; called once when the sync routes are built. */
export function registerIdentityAdapters(): void {
  for (const adapter of identityAdapters) registerAdapter(adapter);
}
