import type { OrganizationContact } from '@prisma/client';
import { visibleRelationsWhere } from '../../relationship/relationship.visibility.js';
import { classifyChanges, toEpoch } from '../sync.changes.js';
import { registerAdapter } from '../sync.registry.js';
import type { Row, SyncAdapter } from '../sync.types.js';
import { refuseEveryLine } from './identity.adapter.js';

type Changes = { created: Row[]; updated: Row[]; deleted: string[] };

const CONTACT_SELECT = {
  id: true,
  organizationId: true,
  kind: true,
  slot: true,
  value: true,
  verifiedAt: true,
  verificationMethod: true,
  createdAt: true,
  serverUpdatedAt: true,
  deletedAt: true,
} as const;

type ContactRow = Pick<OrganizationContact, keyof typeof CONTACT_SELECT>;

/** The explicit field list of a contact; the author is never part of it (ASVS v5.0.0-15.3.1). */
function toRow(c: ContactRow): Row {
  return {
    id: c.id,
    organization_id: c.organizationId,
    kind: c.kind,
    slot: c.slot,
    value: c.value,
    verified_at: c.verifiedAt ? toEpoch(c.verifiedAt) : null,
    verification_method: c.verificationMethod,
    created_at: toEpoch(c.createdAt),
    server_updated_at: toEpoch(c.serverUpdatedAt),
  };
}

/**
 * `organization_contacts` (SYNC-036). Two sources, built only from the viewer's ACTIVE
 * memberships and the relationships the REL-001 predicate lets them see (ASVS v5.0.0-8.2.2):
 *
 * - the team (OWNER, MANAGER, SELLER) gets every contact of its organizations, pending ones
 *   included; a DRIVER gets none here (SYNC-042);
 * - the other side of each visible relationship (whatever the organization's status) gets the
 *   verified contacts only. A contact that went back to pending or was deleted is listed by id in
 *   `deleted`, but only when the phone could already hold it: one created after the last pull is
 *   never named. An organization made visible by a relationship created since the last pull is
 *   sent whole, as `created`.
 *
 * Contacts are written by online routes only: every pushed line is refused.
 */
export const contactsAdapter: SyncAdapter = {
  table: 'organization_contacts',
  async pull(viewer, since, tx): Promise<Changes> {
    const teamOrgs = new Set(
      viewer.memberships
        .filter((m) => m.role === 'OWNER' || m.role === 'MANAGER' || m.role === 'SELLER')
        .map((m) => m.organizationId)
    );

    const teamRows = await tx.organizationContact.findMany({
      where: {
        organizationId: { in: [...teamOrgs] },
        ...(since ? { serverUpdatedAt: { gt: since } } : { deletedAt: null }),
      },
      select: CONTACT_SELECT,
      orderBy: { id: 'asc' },
    });
    const result = classifyChanges(
      teamRows,
      since,
      (r) => r.createdAt,
      (r) => toRow(r)
    );

    const relationships = await tx.customerRelationship.findMany({
      where: visibleRelationsWhere({ personId: viewer.personId, organizationIds: [...teamOrgs] }),
      select: { supplierOrganizationId: true, customerOrganizationId: true, createdAt: true },
    });
    const partyOrgs = new Set<string>();
    const knownOrgs = new Set<string>();
    for (const r of relationships) {
      for (const org of [r.supplierOrganizationId, r.customerOrganizationId]) {
        if (org === null || teamOrgs.has(org)) continue;
        partyOrgs.add(org);
        if (since === null || r.createdAt <= since) knownOrgs.add(org);
      }
    }
    if (partyOrgs.size === 0) return result;
    const newOrgs = [...partyOrgs].filter((org) => !knownOrgs.has(org));

    const partyRows = await tx.organizationContact.findMany({
      where: since
        ? {
            organizationId: { in: [...partyOrgs] },
            OR: [
              { serverUpdatedAt: { gt: since } },
              { organizationId: { in: newOrgs }, deletedAt: null, verifiedAt: { not: null } },
            ],
          }
        : { organizationId: { in: [...partyOrgs] }, deletedAt: null, verifiedAt: { not: null } },
      select: CONTACT_SELECT,
      orderBy: { id: 'asc' },
    });
    const isNew = new Set(newOrgs);
    for (const c of partyRows) {
      const live = c.deletedAt === null && c.verifiedAt !== null;
      if (live) {
        const whole = isNew.has(c.organizationId) || since === null || c.createdAt > since;
        (whole ? result.created : result.updated).push(toRow(c));
      } else if (since && !isNew.has(c.organizationId) && c.createdAt <= since) {
        result.deleted.push(c.id);
      }
    }
    return result;
  },
  push: (_ctx, change) => Promise.resolve(refuseEveryLine(change)),
};

/** Registers the contacts adapter; called once when the sync routes are built. */
export function registerContactAdapters(): void {
  registerAdapter(contactsAdapter);
}
