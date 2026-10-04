import type { Actor } from '../../types/express.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { checkAndConsume } from '../../lib/rate-limit.js';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  bumpScopeVersion,
  findOrCreateByPhone,
  toPublicPerson,
} from '../person/person.repository.js';
import {
  activateInvitation,
  findActiveOwnerId,
  findCollaboration,
  findCollaborationWithPerson,
  findOrganization,
  insertInvitation,
  insertOrganizationWithOwner,
  listActiveOrganizations,
  listInvitations,
  reinviteRevoked,
  revokeInvitation,
  runInTransaction,
  updateRole,
} from './organization.repository.js';
import type {
  CollaborationView,
  CreateOrganizationInput,
  InvitationItem,
  InviteInput,
  MyOrganizationItem,
  OrganizationView,
} from './organization.schemas.js';

/**
 * Creates an organization owned by the caller.
 *
 * The owner is always the authenticated person, never a body field (ASVS v5.0.0-8.2.1).
 *
 * @param personId - Authenticated person who becomes the OWNER.
 * @param input - Validated body.
 * @returns The closed organization view with the caller's role.
 */
export async function createOrganization(
  personId: string,
  input: CreateOrganizationInput
): Promise<OrganizationView> {
  const org = await insertOrganizationWithOwner(personId, input);
  return {
    id: org.id,
    name: org.name,
    description: org.description,
    email: org.email,
    status: org.status,
    created_at: org.createdAt.toISOString(),
    role: 'OWNER',
  };
}

/**
 * Lists the caller's organizations (ACTIVE collaborations only), newest first.
 *
 * @param personId - Authenticated person; never a client-supplied id.
 * @param query - Validated page size and cursor.
 * @returns A page of closed items and the next cursor.
 */
export async function listMyOrganizations(
  personId: string,
  query: { limit: number; cursor?: string }
): Promise<{ items: MyOrganizationItem[]; next_cursor: string | null }> {
  const { rows, nextCursor } = await listActiveOrganizations(personId, query);
  return {
    items: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, role: r.role })),
    next_cursor: nextCursor,
  };
}

/**
 * Returns one organization's details with the actor's role.
 *
 * @param actor - Actor loaded from the path by `loadActor`.
 * @throws 404 `NOT_FOUND` if the organization vanished between the membership check and the read.
 */
export async function getOrganizationDetails(actor: Actor): Promise<OrganizationView> {
  const org = await findOrganization(actor.organizationId);
  if (!org) throw httpError(404, 'NOT_FOUND', 'Not found');
  return {
    id: org.id,
    name: org.name,
    description: org.description,
    email: org.email,
    status: org.status,
    created_at: org.createdAt.toISOString(),
    role: actor.role,
  };
}

// Same allowance and key as the person lookup (PER): the invite resolves a number to a person,
// so it must not be a way around the enumeration limit (ASVS v5.0.0-2.4.1).
const LOOKUP_LIMIT = 60;
const LOOKUP_WINDOW_SECONDS = 3600;

const INVITED_CONTENT = {
  FR: (organizationName: string) => `Vous etes invite a rejoindre l'equipe de ${organizationName}.`,
  EN: (organizationName: string) => `You are invited to join the team of ${organizationName}.`,
};

/**
 * Invites a person, found or created as a guest by phone number, into the actor's organization.
 *
 * The organization and the inviter come from the loaded actor, never from the body (ASVS
 * v5.0.0-8.2.1). A REVOKED row of the same person is reused; an ACTIVE or INVITED one is a
 * conflict (C-05). A registered invitee is notified in the same transaction, so a rolled-back
 * invitation never leaves a notification. Sending the WhatsApp or SMS message is the client's job.
 *
 * @param actor - Owner loaded from the path and checked for `manage Collaboration`.
 * @param input - Validated body: gesture id, E.164 number and role.
 * @returns The closed collaboration view.
 * @throws 409 `ORGANIZATION_NOT_ACTIVE`, 409 `ALREADY_MEMBER`, 429 `RATE_LIMITED`.
 */
export async function inviteCollaborator(
  actor: Actor,
  input: InviteInput
): Promise<CollaborationView> {
  const allowance = await checkAndConsume(
    `lookup:${actor.personId}`,
    LOOKUP_LIMIT,
    LOOKUP_WINDOW_SECONDS
  );
  if (!allowance.allowed) {
    logger.warn({ event: 'lookup_rate_limited', personId: actor.personId }, 'Lookup rate limited');
    throw httpError(429, 'RATE_LIMITED', 'Too many person lookups');
  }

  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);

    const person = await findOrCreateByPhone(input.phone_number, tx);
    const existing = await findCollaboration(tx, person.id, actor.organizationId);
    if (existing && existing.status !== 'REVOKED') {
      throw httpError(409, 'ALREADY_MEMBER', 'Already a member');
    }

    const collaboration = existing
      ? await reinviteRevoked(tx, existing.id, input.role)
      : await insertInvitation(tx, {
          id: input.id,
          personId: person.id,
          organizationId: actor.organizationId,
          role: input.role,
        });

    if (person.registeredAt !== null) {
      const org = await findOrganization(actor.organizationId);
      if (!org) throw httpError(404, 'NOT_FOUND', 'Not found');
      const language = await recipientLanguage(person.id, tx);
      await notify(
        {
          recipientId: person.id,
          organizationId: actor.organizationId,
          sourceEvent: 'collaboration.invited',
          content: language === 'EN' ? INVITED_CONTENT.EN(org.name) : INVITED_CONTENT.FR(org.name),
          related: { type: 'collaboration', id: collaboration.id },
        },
        tx
      );
    }

    return {
      id: collaboration.id,
      person: toPublicPerson(person),
      role: collaboration.role,
      status: 'INVITED',
      invited_at: collaboration.invitedAt.toISOString(),
    };
  });
}

const ACCEPTED_CONTENT = {
  FR: (organizationName: string) =>
    `Une personne invitee a rejoint l'equipe de ${organizationName}.`,
  EN: (organizationName: string) => `An invited person has joined the team of ${organizationName}.`,
};

/**
 * Lists the caller's own pending invitations, newest first.
 *
 * @param personId - Authenticated person; never a client-supplied id (ASVS v5.0.0-8.2.2).
 * @param query - Validated page size and cursor.
 * @returns A page of closed items (explicit fields, ASVS v5.0.0-15.3.1) and the next cursor.
 */
export async function listMyInvitations(
  personId: string,
  query: { limit: number; cursor?: string }
): Promise<{ items: InvitationItem[]; next_cursor: string | null }> {
  const { rows, nextCursor } = await listInvitations(personId, query);
  return {
    items: rows.map((r) => ({
      id: r.id,
      organization_id: r.organizationId,
      organization_name: r.organizationName,
      role: r.role,
      invited_at: r.invitedAt.toISOString(),
    })),
    next_cursor: nextCursor,
  };
}

/**
 * The invited person joins the organization: INVITED becomes ACTIVE, the caller's scope version
 * is bumped (CM-03) and the owner is notified, all in one transaction (C-05).
 *
 * The update filters on the collaboration id and the person id from the token, so the role in
 * the row is never touched and another person's invitation looks absent (ASVS v5.0.0-8.2.2).
 *
 * @param personId - Authenticated invitee.
 * @param collaborationId - Collaboration from the path.
 * @throws 404 `NOT_FOUND` when the row is not the caller's INVITED collaboration.
 */
export async function acceptInvitation(personId: string, collaborationId: string): Promise<void> {
  await runInTransaction(async (tx) => {
    const activated = await activateInvitation(tx, personId, collaborationId);
    if (!activated) throw httpError(404, 'NOT_FOUND', 'Not found');

    await bumpScopeVersion(personId, tx);

    const ownerId = await findActiveOwnerId(tx, activated.organizationId);
    const org = await findOrganization(activated.organizationId);
    if (!ownerId || !org) throw httpError(404, 'NOT_FOUND', 'Not found');
    const language = await recipientLanguage(ownerId, tx);
    await notify(
      {
        recipientId: ownerId,
        organizationId: activated.organizationId,
        sourceEvent: 'collaboration.accepted',
        content: language === 'EN' ? ACCEPTED_CONTENT.EN(org.name) : ACCEPTED_CONTENT.FR(org.name),
        related: { type: 'collaboration', id: collaborationId },
      },
      tx
    );
  });
}

/**
 * The invited person turns the invitation down: INVITED becomes REVOKED, so the organization can
 * invite them again later (C-05).
 *
 * @param personId - Authenticated invitee.
 * @param collaborationId - Collaboration from the path.
 * @throws 404 `NOT_FOUND` when the row is not the caller's INVITED collaboration.
 */
export async function declineInvitation(personId: string, collaborationId: string): Promise<void> {
  if (!(await revokeInvitation(personId, collaborationId))) {
    throw httpError(404, 'NOT_FOUND', 'Not found');
  }
}

const ROLE_CHANGED_CONTENT = {
  FR: (organizationName: string, role: string) =>
    `Votre role dans l'equipe de ${organizationName} est maintenant ${role}.`,
  EN: (organizationName: string, role: string) =>
    `Your role in the team of ${organizationName} is now ${role}.`,
};

/**
 * The owner changes a collaborator's role. The target is looked up inside the actor's
 * organization, so another business's row looks absent (ASVS v5.0.0-8.2.1). The OWNER row is
 * protected (CM-09). An ACTIVE target gets a scope version bump (CM-03) and a notification in the
 * same transaction; an INVITED target has no rights yet, so only the role is written.
 *
 * @param actor - Owner loaded from the path and checked for `manage Collaboration`.
 * @param collaborationId - Collaboration from the path.
 * @param role - New role from the validated body; never OWNER.
 * @returns The closed collaboration view.
 * @throws 404 `NOT_FOUND` for an unknown, foreign or REVOKED row; 409 `OWNER_PROTECTED`.
 */
export async function changeRole(
  actor: Actor,
  collaborationId: string,
  role: 'MANAGER' | 'SELLER' | 'DRIVER'
): Promise<CollaborationView> {
  return runInTransaction(async (tx) => {
    const target = await findCollaborationWithPerson(tx, collaborationId, actor.organizationId);
    if (!target || target.status === 'REVOKED') throw httpError(404, 'NOT_FOUND', 'Not found');
    if (target.role === 'OWNER') {
      throw httpError(409, 'OWNER_PROTECTED', 'The owner role cannot be changed');
    }

    const updated = await updateRole(tx, collaborationId, actor.organizationId, role);
    if (!updated) throw httpError(404, 'NOT_FOUND', 'Not found');

    if (updated.status === 'ACTIVE') {
      await bumpScopeVersion(target.personId, tx);
      const org = await findOrganization(actor.organizationId);
      if (!org) throw httpError(404, 'NOT_FOUND', 'Not found');
      const language = await recipientLanguage(target.personId, tx);
      await notify(
        {
          recipientId: target.personId,
          organizationId: actor.organizationId,
          sourceEvent: 'collaboration.role_changed',
          content:
            language === 'EN'
              ? ROLE_CHANGED_CONTENT.EN(org.name, role)
              : ROLE_CHANGED_CONTENT.FR(org.name, role),
          related: { type: 'collaboration', id: updated.id },
        },
        tx
      );
    }

    return {
      id: updated.id,
      person: toPublicPerson(target.person),
      role: updated.role,
      status: updated.status === 'ACTIVE' ? 'ACTIVE' : 'INVITED',
      invited_at: updated.invitedAt.toISOString(),
    };
  });
}
