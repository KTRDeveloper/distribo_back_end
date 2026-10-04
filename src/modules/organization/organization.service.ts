import type { Actor } from '../../types/express.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { checkAndConsume } from '../../lib/rate-limit.js';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { findOrCreateByPhone, toPublicPerson } from '../person/person.repository.js';
import {
  findCollaboration,
  findOrganization,
  insertInvitation,
  insertOrganizationWithOwner,
  listActiveOrganizations,
  reinviteRevoked,
  runInTransaction,
} from './organization.repository.js';
import type {
  CollaborationView,
  CreateOrganizationInput,
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
