import { Prisma, type Collaboration, type Person, type Subscription } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { httpError } from '../../lib/http-error.js';
import { imageKeySchema } from '../../lib/image-keys.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import { newId } from '../../shared/ids.js';
import { bumpScopeVersion } from '../person/person.repository.js';
import type { CreateOrganizationInput } from './organization.schemas.js';

export type CreatedOrganization = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  paymentCode: string;
  plan: 'FREE' | 'ESSENTIAL' | 'PRO' | 'ENTERPRISE';
  planEndsAt: Date | null;
  graceEndsAt: Date | null;
  maxCollaborators: number | null;
  maxProducts: number | null;
};

const ORGANIZATION_SELECT = {
  id: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  paymentCode: true,
  plan: true,
  planEndsAt: true,
  graceEndsAt: true,
  maxCollaborators: true,
  maxProducts: true,
} as const;

/**
 * Tells whether an error is the unique violation of `payment_code` (C-41), the only one the
 * creation retries. Any other unique violation (such as the gesture id) is not a collision.
 * The PostgreSQL driver adapter reports the violated index in `meta.driverAdapterError`.
 */
export function isPaymentCodeCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const meta = error.meta as
    | {
        target?: unknown;
        driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } };
      }
    | undefined;
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  const named = [meta?.target, constraint?.index, constraint?.fields].flat();
  return named.some((value) => typeof value === 'string' && value.includes('payment_code'));
}

/**
 * Inserts an organization, its ACTIVE OWNER collaboration and the owner's scope bump in one
 * transaction (C-05: exactly one active owner at commit; CM-03; ASVS v5.0.0-2.3.3).
 *
 * @param personId - Owner, taken from the token.
 * @param input - Validated body.
 * @param plan - Payment code and free-plan limits chosen by the server (C-41), never the body.
 * @param inSameTransaction - Extra writes that must commit or roll back with the organization.
 * @returns The stored organization fields.
 */
export async function insertOrganizationWithOwner(
  personId: string,
  input: CreateOrganizationInput,
  plan: { paymentCode: string; maxCollaborators: number | null; maxProducts: number | null },
  inSameTransaction?: (tx: Prisma.TransactionClient, org: CreatedOrganization) => Promise<void>
): Promise<CreatedOrganization> {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        id: input.id,
        name: input.name,
        description: input.description ?? null,
        paymentCode: plan.paymentCode,
        plan: 'FREE',
        maxCollaborators: plan.maxCollaborators,
        maxProducts: plan.maxProducts,
      },
      select: ORGANIZATION_SELECT,
    });

    await tx.collaboration.create({
      data: {
        id: newId(),
        personId,
        organizationId: org.id,
        role: 'OWNER',
        status: 'ACTIVE',
        isPublicContact: true,
        acceptedAt: new Date(),
      },
    });

    await inSameTransaction?.(tx, org);

    await bumpScopeVersion(personId, tx);
    return org;
  });
}

export type MyOrganizationRow = {
  id: string;
  name: string;
  status: string;
  role: string;
  createdAt: Date;
};

/**
 * Finds the person's ACTIVE, non-deleted collaboration in a non-deleted organization.
 *
 * @param personId - Person from the token.
 * @param organizationId - Organization id from the path.
 * @returns The collaboration or null.
 */
export function findActiveCollaboration(
  personId: string,
  organizationId: string
): Promise<Collaboration | null> {
  return prisma.collaboration.findFirst({
    where: {
      personId,
      organizationId,
      status: 'ACTIVE',
      deletedAt: null,
      organization: { deletedAt: null },
    },
  });
}

/**
 * Reads the status of a non-deleted organization.
 *
 * @param organizationId - Organization to read.
 * @param tx - Optional transaction client.
 * @returns The status, or null when the organization does not exist.
 */
export async function findOrganizationStatus(
  organizationId: string,
  tx?: Prisma.TransactionClient
): Promise<string | null> {
  const org = await (tx ?? prisma).organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { status: true },
  });
  return org?.status ?? null;
}

/**
 * Lists the organizations where the person has an ACTIVE collaboration, newest first
 * (created_at descending then id), keyset-paged.
 *
 * @param personId - Person from the token.
 * @param query - Page size and optional opaque cursor.
 * @returns Rows (at most limit) and the cursor of the next page, or null.
 */
export async function listActiveOrganizations(
  personId: string,
  query: { limit: number; cursor?: string }
): Promise<{ rows: MyOrganizationRow[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const found = await prisma.collaboration.findMany({
    where: {
      personId,
      status: 'ACTIVE',
      deletedAt: null,
      organization: {
        deletedAt: null,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
    },
    select: {
      role: true,
      organization: { select: { id: true, name: true, status: true, createdAt: true } },
    },
    orderBy: [{ organization: { createdAt: 'desc' } }, { organizationId: 'asc' }],
    take: query.limit + 1,
  });
  const page = found.slice(0, query.limit).map((c) => ({
    id: c.organization.id,
    name: c.organization.name,
    status: c.organization.status,
    role: c.role,
    createdAt: c.organization.createdAt,
  }));
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

/**
 * Reads the stored fields of one non-deleted organization.
 *
 * @param organizationId - Organization id taken from the loaded actor.
 */
export function findOrganization(organizationId: string): Promise<CreatedOrganization | null> {
  return prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: ORGANIZATION_SELECT,
  });
}

/**
 * Adds `delta` to a collaborator's held money with one atomic SQL increment inside the caller's
 * transaction, so simultaneous operations never lose an update (C-37; ASVS v5.0.0-2.3.3,
 * v5.0.0-2.3.4). Never read then write. The value may go negative. Callers update the customer
 * relationship balance first, then this value (C-37). Rows marked deleted are ignored (C-35).
 *
 * @param tx - The caller's transaction; a rollback undoes the increment.
 * @param personId - Collaborator.
 * @param organizationId - Organization holding the money.
 * @param delta - Signed amount in XAF to add.
 * @throws 404 NOT_FOUND when the person is not a collaborator of the organization.
 */
export async function addAmountHeld(
  tx: Prisma.TransactionClient,
  personId: string,
  organizationId: string,
  delta: bigint
): Promise<void> {
  const updated = await tx.$executeRaw`
    UPDATE collaborations SET amount_held = amount_held + ${delta}
    WHERE person_id = ${personId}::uuid AND organization_id = ${organizationId}::uuid
      AND deleted_at IS NULL
  `;
  if (updated === 0) throw httpError(404, 'NOT_FOUND', 'Not found');
}

/**
 * Reads a person's `amount_held` in an organization and locks the row until the transaction ends,
 * so a parallel expense or handover cannot change the amount between this read and the handover
 * written from it (CWE-362).
 *
 * @returns The amount held, or null when the person has no live collaboration in the organization.
 */
export async function lockAmountHeld(
  tx: Prisma.TransactionClient,
  personId: string,
  organizationId: string
): Promise<bigint | null> {
  const rows = await tx.$queryRaw<{ amount_held: bigint }[]>`
    SELECT amount_held FROM collaborations
    WHERE person_id = ${personId}::uuid AND organization_id = ${organizationId}::uuid
      AND deleted_at IS NULL
    FOR UPDATE
  `;
  return rows[0]?.amount_held ?? null;
}

/**
 * Locks the organization row until the transaction ends and reads its collaborator limit from
 * the stored plan, so two simultaneous invitations count the team one after the other (C-42,
 * CWE-362).
 *
 * @returns The plan's `max_collaborators` (null = no limit).
 * @throws 404 `NOT_FOUND` when the organization is absent or deleted.
 */
export async function lockOrganizationSeats(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<{ maxCollaborators: number | null }> {
  const rows = await tx.$queryRaw<{ max_collaborators: number | null }[]>`
    SELECT max_collaborators FROM organizations
    WHERE id = ${organizationId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw httpError(404, 'NOT_FOUND', 'Not found');
  return { maxCollaborators: row.max_collaborators };
}

/**
 * Counts the places taken in the team: ACTIVE or INVITED collaborations, owner and deleted rows
 * excluded. REVOKED and PAUSED rows do not count (C-42).
 */
export function countTeamSeats(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<number> {
  return tx.collaboration.count({
    where: {
      organizationId,
      deletedAt: null,
      role: { not: 'OWNER' },
      status: { in: ['ACTIVE', 'INVITED'] },
    },
  });
}

/**
 * Runs `work` in one database transaction so the person, the collaboration and the
 * notification of one gesture commit or fail together.
 *
 * @param work - Callback receiving the transaction client.
 */
export function runInTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(work);
}

/**
 * Reads the person's non-deleted collaboration in an organization, whatever its status.
 *
 * @param tx - Transaction client of the gesture.
 * @param personId - Invitee.
 * @param organizationId - Organization from the loaded actor.
 */
export function findCollaboration(
  tx: Prisma.TransactionClient,
  personId: string,
  organizationId: string
): Promise<Collaboration | null> {
  return tx.collaboration.findFirst({ where: { personId, organizationId, deletedAt: null } });
}

/**
 * Inserts an INVITED collaboration that is not a public contact (C-05).
 *
 * A concurrent insert for the same person and organization breaks the database uniqueness rule;
 * it is mapped to the same `ALREADY_MEMBER` answer as a sequential repeat.
 *
 * @throws 409 `ALREADY_MEMBER` on a unique violation.
 */
export async function insertInvitation(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    personId: string;
    organizationId: string;
    role: 'MANAGER' | 'SELLER' | 'DRIVER';
  }
): Promise<Collaboration> {
  try {
    return await tx.collaboration.create({
      data: { ...data, status: 'INVITED', isPublicContact: false },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw httpError(409, 'ALREADY_MEMBER', 'Already a member');
    }
    throw error;
  }
}

/**
 * Turns a REVOKED collaboration back into an INVITED one with a new role, a fresh `invited_at`
 * and an empty `accepted_at`. Only a row still REVOKED is updated, so a concurrent acceptance or
 * invitation is never overwritten.
 *
 * @throws 409 `ALREADY_MEMBER` when the row is no longer REVOKED.
 */
export async function reinviteRevoked(
  tx: Prisma.TransactionClient,
  id: string,
  role: 'MANAGER' | 'SELLER' | 'DRIVER'
): Promise<Collaboration> {
  const updated = await tx.collaboration.updateManyAndReturn({
    where: { id, status: 'REVOKED', deletedAt: null },
    data: {
      status: 'INVITED',
      role,
      invitedAt: new Date(),
      acceptedAt: null,
      isPublicContact: false,
    },
  });
  const row = updated[0];
  if (!row) throw httpError(409, 'ALREADY_MEMBER', 'Already a member');
  return row;
}

export type InvitationRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
  invitedAt: Date;
};

/**
 * Lists the person's INVITED collaborations in non-deleted organizations, newest invitation first
 * (invited_at descending then id), keyset-paged. Filters on the person from the token only.
 *
 * @param personId - Invitee from the token.
 * @param query - Page size and optional opaque cursor.
 * @returns Rows (at most limit) and the cursor of the next page, or null.
 */
export async function listInvitations(
  personId: string,
  query: { limit: number; cursor?: string }
): Promise<{ rows: InvitationRow[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const found = await prisma.collaboration.findMany({
    where: {
      personId,
      status: 'INVITED',
      deletedAt: null,
      organization: { deletedAt: null },
      ...(cursor
        ? {
            OR: [
              { invitedAt: { lt: cursor.createdAt } },
              { invitedAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      organizationId: true,
      role: true,
      invitedAt: true,
      organization: { select: { name: true } },
    },
    orderBy: [{ invitedAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const rows = found.slice(0, query.limit).map((c) => ({
    id: c.id,
    organizationId: c.organizationId,
    organizationName: c.organization.name,
    role: c.role,
    invitedAt: c.invitedAt,
  }));
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.invitedAt, id: last.id })
        : null,
  };
}

/**
 * Turns the person's own INVITED collaboration into ACTIVE with `accepted_at` = now. The update
 * filters on the collaboration id, the person id, the INVITED status and a registered person, so
 * another person's id, a repeat or a guest matches nothing (ASVS v5.0.0-8.2.2, C-05). The role is
 * never written.
 *
 * @returns The organization id of the activated row, or null when nothing matched.
 */
export async function activateInvitation(
  tx: Prisma.TransactionClient,
  personId: string,
  collaborationId: string
): Promise<{ organizationId: string } | null> {
  const updated = await tx.collaboration.updateManyAndReturn({
    where: {
      id: collaborationId,
      personId,
      status: 'INVITED',
      deletedAt: null,
      person: { registeredAt: { not: null } },
      organization: { deletedAt: null },
    },
    data: { status: 'ACTIVE', acceptedAt: new Date() },
    select: { organizationId: true },
  });
  return updated[0] ?? null;
}

/**
 * Turns the person's own INVITED collaboration into REVOKED, filtered like `activateInvitation`.
 *
 * @returns True when a row was updated.
 */
export async function revokeInvitation(
  personId: string,
  collaborationId: string
): Promise<boolean> {
  const result = await prisma.collaboration.updateMany({
    where: { id: collaborationId, personId, status: 'INVITED', deletedAt: null },
    data: { status: 'REVOKED' },
  });
  return result.count > 0;
}

/**
 * Finds the person id of the organization's ACTIVE OWNER (exactly one by C-05).
 *
 * @param tx - Transaction client of the gesture.
 * @param organizationId - Organization of the accepted invitation.
 */
export async function findActiveOwnerId(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<string | null> {
  const owner = await tx.collaboration.findFirst({
    where: { organizationId, role: 'OWNER', status: 'ACTIVE', deletedAt: null },
    select: { personId: true },
  });
  return owner?.personId ?? null;
}

/**
 * Reads a non-deleted collaboration of the organization with its person, whatever its status.
 * The organization filter makes another business's row look absent (ASVS v5.0.0-8.2.2).
 *
 * @param tx - Transaction client of the gesture.
 * @param collaborationId - Collaboration from the path.
 * @param organizationId - Organization from the loaded actor, never from the client.
 */
export function findCollaborationWithPerson(
  tx: Prisma.TransactionClient,
  collaborationId: string,
  organizationId: string
): Promise<(Collaboration & { person: Person }) | null> {
  return tx.collaboration.findFirst({
    where: { id: collaborationId, organizationId, deletedAt: null },
    include: { person: true },
  });
}

/**
 * Writes the role of a non-OWNER, non-REVOKED collaboration of the organization. The filter
 * repeats the checks of the service, so a concurrent revocation or ownership change is never
 * overwritten. Nothing else is written (ASVS v5.0.0-8.2.3).
 *
 * @returns The updated row, or null when nothing matched.
 */
export async function updateRole(
  tx: Prisma.TransactionClient,
  collaborationId: string,
  organizationId: string,
  role: 'MANAGER' | 'SELLER' | 'DRIVER'
): Promise<Collaboration | null> {
  const updated = await tx.collaboration.updateManyAndReturn({
    where: {
      id: collaborationId,
      organizationId,
      deletedAt: null,
      status: { in: ['ACTIVE', 'INVITED'] },
      role: { not: 'OWNER' },
    },
    data: { role },
  });
  return updated[0] ?? null;
}

/**
 * Turns a non-OWNER, non-REVOKED collaboration of the organization into REVOKED and clears its
 * public-contact flag. `amount_held` is not written: the money stays visible (CM-09). The filter
 * repeats the service checks, so a concurrent revocation or ownership change is never overwritten.
 *
 * @returns The updated row, or null when nothing matched.
 */
export async function revokeCollaboration(
  tx: Prisma.TransactionClient,
  collaborationId: string,
  organizationId: string
): Promise<Collaboration | null> {
  const updated = await tx.collaboration.updateManyAndReturn({
    where: {
      id: collaborationId,
      organizationId,
      deletedAt: null,
      status: { in: ['ACTIVE', 'INVITED'] },
      role: { not: 'OWNER' },
    },
    data: { status: 'REVOKED', isPublicContact: false },
  });
  return updated[0] ?? null;
}

/**
 * Turns the person's own ACTIVE OWNER collaboration into MANAGER. Run first in a transfer: the
 * partial unique index allows one ACTIVE OWNER at every statement, while the deferred check needs
 * exactly one only at commit. The flag `is_public_contact` is not written (ORG-015).
 *
 * @returns True when the row was still the ACTIVE OWNER and was demoted.
 */
export async function demoteOwner(
  tx: Prisma.TransactionClient,
  personId: string,
  organizationId: string
): Promise<boolean> {
  const result = await tx.collaboration.updateMany({
    where: { personId, organizationId, role: 'OWNER', status: 'ACTIVE', deletedAt: null },
    data: { role: 'MANAGER' },
  });
  return result.count > 0;
}

/**
 * Turns an ACTIVE non-OWNER collaboration of the organization into OWNER. The filter repeats the
 * service checks, so a concurrent revocation is never overwritten. Nothing else is written.
 *
 * @returns True when the row was promoted.
 */
export async function promoteToOwner(
  tx: Prisma.TransactionClient,
  collaborationId: string,
  organizationId: string
): Promise<boolean> {
  const result = await tx.collaboration.updateMany({
    where: {
      id: collaborationId,
      organizationId,
      status: 'ACTIVE',
      role: { not: 'OWNER' },
      deletedAt: null,
    },
    data: { role: 'OWNER' },
  });
  return result.count > 0;
}

/**
 * Writes the public-contact flag of the person's own ACTIVE collaboration. The row is selected by
 * person id and organization id (ASVS v5.0.0-8.2.2); nothing else is written (ASVS v5.0.0-15.3.3).
 * Turning the flag on also requires a current phone number, the same rule the database enforces
 * (C-05), so the caller gets a coded answer rather than a constraint error.
 *
 * @returns The updated row, or null when nothing matched.
 */
export async function updatePublicContact(
  tx: Prisma.TransactionClient,
  personId: string,
  organizationId: string,
  value: boolean
): Promise<Collaboration | null> {
  const updated = await tx.collaboration.updateManyAndReturn({
    where: {
      personId,
      organizationId,
      deletedAt: null,
      status: 'ACTIVE',
      ...(value ? { person: { phoneNumber: { not: null } } } : {}),
    },
    data: { isPublicContact: value },
  });
  return updated[0] ?? null;
}

/**
 * Sets to EXPIRED every ACTIVE subscription of the organization whose end has passed, so a lapsed
 * row never blocks a new one (C-31). A row without an end date never lapses.
 *
 * @param tx - Transaction client of the gesture.
 * @param organizationId - Organization from the loaded actor.
 * @param now - Instant used for the comparison.
 */
export async function expireLapsedSubscriptions(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date
): Promise<void> {
  await tx.subscription.updateMany({
    where: { organizationId, status: 'ACTIVE', endsAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
}

/**
 * Inserts an ACTIVE subscription starting at `startsAt`. The partial unique index (C-31) arbitrates
 * a concurrent start.
 *
 * @throws 409 `SUBSCRIPTION_EXISTS` when the organization already has an ACTIVE subscription.
 */
export async function insertSubscription(
  tx: Prisma.TransactionClient,
  data: { id: string; organizationId: string; plan: string; startsAt: Date; endsAt: Date }
): Promise<Subscription> {
  try {
    return await tx.subscription.create({ data: { ...data, status: 'ACTIVE' } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw httpError(409, 'SUBSCRIPTION_EXISTS', 'The organization already has a subscription');
    }
    throw error;
  }
}

/**
 * Ends the organization's ACTIVE subscription: status EXPIRED and `ends_at` = `now`. The row is
 * kept as history. One conditional update, so two concurrent ends cannot both succeed. Pass `tx`
 * to run inside a larger gesture (ORG-016).
 *
 * @returns true when a row was ended, false when none was ACTIVE.
 */
export async function endActiveSubscription(
  organizationId: string,
  now: Date,
  tx?: Prisma.TransactionClient
): Promise<boolean> {
  const result = await (tx ?? prisma).subscription.updateMany({
    where: { organizationId, status: 'ACTIVE' },
    data: { status: 'EXPIRED', endsAt: now },
  });
  return result.count > 0;
}

/**
 * Moves an ACTIVE, non-deleted organization to CLOSED. One conditional update, so two concurrent
 * closes cannot both succeed and a SUSPENDED or CLOSED organization matches nothing (CM-10).
 *
 * @returns true when the organization was ACTIVE and is now CLOSED.
 */
export async function closeActiveOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<boolean> {
  const result = await tx.organization.updateMany({
    where: { id: organizationId, status: 'ACTIVE', deletedAt: null },
    data: { status: 'CLOSED' },
  });
  return result.count > 0;
}

/**
 * Moves a CLOSED, non-deleted organization back to ACTIVE. One conditional update, so a SUSPENDED
 * (moderation) or ACTIVE organization matches nothing and a suspension is never lifted here (CM-10).
 *
 * @returns true when the organization was CLOSED and is now ACTIVE.
 */
export async function reopenClosedOrganization(organizationId: string): Promise<boolean> {
  const result = await prisma.organization.updateMany({
    where: { id: organizationId, status: 'CLOSED', deletedAt: null },
    data: { status: 'ACTIVE' },
  });
  return result.count > 0;
}

/**
 * Turns every non-OWNER ACTIVE or INVITED collaboration of the organization into REVOKED and clears
 * its public-contact flag; `amount_held` is not written (CM-09, CM-10). ACTIVE rows are revoked in
 * their own statement so the caller knows whose rights ended (scope bump and notification).
 *
 * @returns The person ids whose ACTIVE collaboration was revoked, with the collaboration id.
 */
export async function revokeNonOwnerCollaborations(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<{ id: string; personId: string }[]> {
  const revoked = await tx.collaboration.updateManyAndReturn({
    where: { organizationId, deletedAt: null, status: 'ACTIVE', role: { not: 'OWNER' } },
    data: { status: 'REVOKED', isPublicContact: false },
    select: { id: true, personId: true },
  });
  await tx.collaboration.updateMany({
    where: { organizationId, deletedAt: null, status: 'INVITED', role: { not: 'OWNER' } },
    data: { status: 'REVOKED', isPublicContact: false },
  });
  return revoked;
}

/** Reads the organization's ACTIVE subscription, or null. */
export async function findActiveSubscription(organizationId: string): Promise<Subscription | null> {
  return prisma.subscription.findFirst({ where: { organizationId, status: 'ACTIVE' } });
}

/** Most businesses one number can return; a person is a public contact of few organizations. */
const LOOKUP_RESULT_MAX = 50;

/**
 * Finds the ACTIVE, non-deleted organizations that hold a live, verified PHONE
 * `OrganizationContact` with value `e164` (CM-26). Only the business's own proven contacts are
 * compared: the person behind the number and the `is_public_contact` flag are not read, and a
 * pending, deleted or EMAIL contact matches nothing (C-44). Selects three fields, never contact
 * or collaborator data (ASVS v5.0.0-15.3.1).
 *
 * @param e164 - Normalized E.164 number.
 */
export function findOrganizationsByPublicNumber(
  e164: string
): Promise<Array<{ id: string; name: string; description: string | null }>> {
  return prisma.organization.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      contacts: {
        some: {
          kind: 'PHONE',
          value: e164,
          verifiedAt: { not: null },
          deletedAt: null,
        },
      },
    },
    select: { id: true, name: true, description: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: LOOKUP_RESULT_MAX,
  });
}

export type TeamRow = Collaboration & { person: Person };

/**
 * Lists every non-deleted collaboration of the organization, whatever its status (REVOKED rows
 * stay so that money held by former members remains visible), newest invitation first
 * (invited_at descending then id), keyset-paged. The organization comes from the loaded actor.
 *
 * @param organizationId - Organization from the loaded actor, never from the client.
 * @param query - Page size and optional opaque cursor.
 * @returns Rows (at most limit) with their person and the cursor of the next page, or null.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listTeam(
  organizationId: string,
  query: { limit: number; cursor?: string }
): Promise<{ rows: TeamRow[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const found = await prisma.collaboration.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(cursor
        ? {
            OR: [
              { invitedAt: { lt: cursor.createdAt } },
              { invitedAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    include: { person: true },
    orderBy: [{ invitedAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const rows = found.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.invitedAt, id: last.id })
        : null,
  };
}

export type PlanFields = {
  plan: 'FREE' | 'ESSENTIAL' | 'PRO' | 'ENTERPRISE';
  planEndsAt: Date | null;
  graceEndsAt: Date | null;
  maxCollaborators: number | null;
  maxProducts: number | null;
};

export type TeamSeat = {
  id: string;
  personId: string;
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER';
  status: 'ACTIVE' | 'INVITED' | 'PAUSED';
  invitedAt: Date;
  acceptedAt: Date | null;
};

/**
 * The one writer of the five plan columns after creation (C-41, ASVS v5.0.0-15.3.3): `plan`,
 * `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products`, nothing else. Billing
 * calls it with values it computed; no request field reaches it. The database refuses an invalid
 * combination (FREE with an end date, a paid plan without one, a grace end not after the plan
 * end) and the error is not caught, so the caller's transaction aborts.
 *
 * @param tx - The caller's transaction.
 * @param organizationId - Organization chosen by server code.
 * @param fields - The five plan values.
 */
export async function writePlanFields(
  tx: Prisma.TransactionClient,
  organizationId: string,
  fields: PlanFields
): Promise<void> {
  await tx.organization.updateMany({
    where: { id: organizationId, deletedAt: null },
    data: {
      plan: fields.plan,
      planEndsAt: fields.planEndsAt,
      graceEndsAt: fields.graceEndsAt,
      maxCollaborators: fields.maxCollaborators,
      maxProducts: fields.maxProducts,
    },
  });
}

/**
 * Lists the team seats of an organization: non-OWNER, non-deleted collaborations that are ACTIVE,
 * INVITED or PAUSED, oldest invitation first then id. The organization comes from server code
 * (ASVS v5.0.0-8.2.1).
 */
export async function listTeamSeats(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<TeamSeat[]> {
  const rows = await tx.collaboration.findMany({
    where: {
      organizationId,
      deletedAt: null,
      role: { not: 'OWNER' },
      status: { in: ['ACTIVE', 'INVITED', 'PAUSED'] },
    },
    select: {
      id: true,
      personId: true,
      role: true,
      status: true,
      invitedAt: true,
      acceptedAt: true,
    },
    orderBy: [{ invitedAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => ({
    ...row,
    status: row.status as TeamSeat['status'],
  }));
}

/**
 * Pauses or resumes one team seat and bumps the person's `scope_version` (C-42, CM-03).
 * `paused: true` turns ACTIVE or INVITED into PAUSED; `paused: false` turns PAUSED into ACTIVE, or
 * INVITED when `accepted_at` is empty. The conditional update never touches the OWNER (the database
 * also refuses it), a REVOKED row or a deleted row, so a concurrent change is never overwritten.
 *
 * @param tx - The caller's transaction.
 * @param collaborationId - Seat chosen by server code.
 * @param paused - Target state.
 * @returns True when the seat changed, false when there was nothing to change.
 */
export async function setSeatPaused(
  tx: Prisma.TransactionClient,
  collaborationId: string,
  paused: boolean
): Promise<boolean> {
  const base = { id: collaborationId, deletedAt: null, role: { not: 'OWNER' as const } };
  const changed: { personId: string }[] = paused
    ? await tx.collaboration.updateManyAndReturn({
        where: { ...base, status: { in: ['ACTIVE', 'INVITED'] } },
        data: { status: 'PAUSED' },
        select: { personId: true },
      })
    : [
        ...(await tx.collaboration.updateManyAndReturn({
          where: { ...base, status: 'PAUSED', acceptedAt: { not: null } },
          data: { status: 'ACTIVE' },
          select: { personId: true },
        })),
        ...(await tx.collaboration.updateManyAndReturn({
          where: { ...base, status: 'PAUSED', acceptedAt: null },
          data: { status: 'INVITED' },
          select: { personId: true },
        })),
      ];
  for (const { personId } of changed) await bumpScopeVersion(personId, tx);
  return changed.length > 0;
}

/**
 * Reads the logo key of a non-deleted organization (C-49). Server code only: no organization
 * schema exposes the key.
 *
 * @param organizationId - Organization to read.
 * @returns The key, or null when empty or when the organization is absent or deleted.
 */
export async function getLogoKey(organizationId: string): Promise<string | null> {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { logoKey: true },
  });
  return org?.logoKey ?? null;
}

/**
 * The one writer of `Organization.logo_key` (C-49, ASVS v5.0.0-15.3.3): sets, replaces or clears
 * (`null`) the logo key in the caller's transaction and returns the previous key, so the images
 * module can delete the old file after its commit.
 *
 * The organization row is locked before the previous key is read, so two concurrent writers never
 * return the same previous key (v5.0.0-2.2.3). A key already held by another business breaks the
 * unique index; that error is not caught, so the caller's transaction aborts.
 *
 * @param tx - The caller's transaction; a rollback restores the previous key.
 * @param organizationId - Organization chosen by server code.
 * @param key - Canonical `logos/<uuid>.webp` key, or null to clear.
 * @returns The previous key, or null when there was none.
 * @throws {RangeError} when the key is not canonical or not in the `logos` folder.
 * @throws {HttpError} 404 `NOT_FOUND` when the organization is absent or deleted.
 */
export async function setLogoKey(
  tx: Prisma.TransactionClient,
  organizationId: string,
  key: string | null
): Promise<string | null> {
  if (key !== null && (!imageKeySchema.safeParse(key).success || !key.startsWith('logos/'))) {
    throw new RangeError('Invalid logo key');
  }
  const rows = await tx.$queryRaw<{ logo_key: string | null }[]>`
    SELECT logo_key FROM organizations
    WHERE id = ${organizationId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw httpError(404, 'NOT_FOUND', 'Not found');
  await tx.organization.update({ where: { id: organizationId }, data: { logoKey: key } });
  return row.logo_key;
}
