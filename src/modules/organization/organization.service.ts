import type { Actor } from '../../types/express.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { checkAndConsume } from '../../lib/rate-limit.js';
import { generatePaymentCode } from '../../lib/payment-code.js';
import { PLANS } from '../../shared/plans.js';
import { atLeast } from '../../shared/access/roles.js';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { handOverFormerOwnerMoneyInTx } from '../finance/held-money.js';
import { lockPendingOrders, refusePendingOrders } from '../order/order.repository.js';
import { createCounter } from '../relationship/relationship.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  bumpScopeVersion,
  findOrCreateByPhone,
  toPublicPerson,
} from '../person/person.repository.js';
import {
  activateInvitation,
  closeActiveOrganization,
  reopenClosedOrganization,
  demoteOwner,
  findActiveOwnerId,
  findCollaboration,
  findCollaborationWithPerson,
  findOrganization,
  findOrganizationStatus,
  findOrganizationsByPublicNumber,
  insertInvitation,
  insertOrganizationWithOwner,
  countTeamSeats,
  isPaymentCodeCollision,
  lockOrganizationSeats,
  listActiveOrganizations,
  listInvitations,
  listTeam,
  promoteToOwner,
  reinviteRevoked,
  revokeNonOwnerCollaborations,
  revokeCollaboration,
  revokeInvitation,
  runInTransaction,
  updateRole,
} from './organization.repository.js';
import type { CreatedOrganization } from './organization.repository.js';
import { listLiveContacts } from './organization-contact.repository.js';
import { runCloseHooks, runReopenHooks } from './lifecycle-hooks.js';
import type {
  CloseOrganizationInput,
  CloseOrganizationView,
  CollaborationView,
  CollaboratorItem,
  CreateOrganizationInput,
  InvitationItem,
  InviteInput,
  MyOrganizationItem,
  OrganizationLookupItem,
  OrganizationView,
  TransferOwnershipInput,
  TransferOwnershipView,
} from './organization.schemas.js';

/** Label of the counter every organization gets at creation, for anonymous sales. */
const DEFAULT_COUNTER_LABEL = 'Client de passage';

/** Draws allowed for a payment code before the creation fails (C-41). */
const PAYMENT_CODE_ATTEMPTS = 5;

/** Maps a stored organization to the closed view; `email` is never part of it (C-41). */
function toOrganizationView(org: CreatedOrganization, role: string): OrganizationView {
  return {
    id: org.id,
    name: org.name,
    description: org.description,
    status: org.status,
    created_at: org.createdAt.toISOString(),
    role,
    payment_code: org.paymentCode,
    plan: org.plan,
    plan_ends_at: org.planEndsAt?.toISOString() ?? null,
    grace_ends_at: org.graceEndsAt?.toISOString() ?? null,
    max_collaborators: org.maxCollaborators,
    max_products: org.maxProducts,
  };
}

/**
 * Creates an organization owned by the caller, on the free plan with its own payment code.
 *
 * The owner is always the authenticated person, never a body field (ASVS v5.0.0-8.2.1); the
 * code, plan and limits come from the server and `PLANS.FREE` (C-41). The default counter
 * "Client de passage" is created in the same transaction (REL-006). A taken payment code only
 * draws a new one, each try in a new transaction, 5 tries in all; then the error goes up (500).
 * Any other error, including another unique violation, is rethrown unchanged.
 *
 * @param personId - Authenticated person who becomes the OWNER.
 * @param input - Validated body.
 * @returns The closed organization view with the caller's role.
 */
export async function createOrganization(
  personId: string,
  input: CreateOrganizationInput
): Promise<OrganizationView> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const org = await insertOrganizationWithOwner(
        personId,
        input,
        {
          paymentCode: generatePaymentCode(),
          maxCollaborators: PLANS.FREE.maxCollaborators,
          maxProducts: PLANS.FREE.maxProducts,
        },
        async (tx, created) => {
          await createCounter(tx, {
            supplierOrganizationId: created.id,
            label: DEFAULT_COUNTER_LABEL,
            createdById: personId,
          });
        }
      );
      return toOrganizationView(org, 'OWNER');
    } catch (error) {
      if (!isPaymentCodeCollision(error) || attempt >= PAYMENT_CODE_ATTEMPTS) throw error;
      logger.warn({ event: 'organization.payment_code_collision', actorId: personId, attempt });
    }
  }
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
  return toOrganizationView(org, actor.role);
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
 * conflict (C-05), a PAUSED one too. The invitation that would exceed the plan's collaborator
 * limit is refused after locking the organization row (C-42). A registered invitee is notified in the same transaction, so a rolled-back
 * invitation never leaves a notification. Sending the WhatsApp or SMS message is the client's job.
 *
 * @param actor - Owner loaded from the path and checked for `create Collaboration`.
 * @param input - Validated body: gesture id, E.164 number and role.
 * @returns The closed collaboration view.
 * @throws 409 `ORGANIZATION_NOT_ACTIVE`, 409 `ALREADY_MEMBER`, 409 `COLLABORATOR_LIMIT_REACHED`, 429 `RATE_LIMITED`.
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

    // The lock and the count share this transaction, so two invitations cannot both take the
    // last place; the limit comes from the stored plan, never from the request (C-42).
    const { maxCollaborators } = await lockOrganizationSeats(tx, actor.organizationId);
    if (
      maxCollaborators !== null &&
      (await countTeamSeats(tx, actor.organizationId)) >= maxCollaborators
    ) {
      throw httpError(409, 'COLLABORATOR_LIMIT_REACHED', 'Collaborator limit reached');
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
 * same transaction; INVITED and PAUSED targets have no access, so only the role is written.
 *
 * @param actor - Owner loaded from the path and checked for `update Collaboration`.
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
    if (!updated || updated.status === 'REVOKED') throw httpError(404, 'NOT_FOUND', 'Not found');

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
      status: updated.status,
      invited_at: updated.invitedAt.toISOString(),
    };
  });
}

const REVOKED_CONTENT = {
  FR: (organizationName: string) => `Votre acces a l'equipe de ${organizationName} a ete retire.`,
  EN: (organizationName: string) => `Your access to the team of ${organizationName} was removed.`,
};

/**
 * The owner revokes a collaborator: the row becomes REVOKED and stops being the public contact,
 * `amount_held` is kept. The target is looked up inside the actor's organization, so another
 * business's row looks absent (ASVS v5.0.0-8.2.1). The OWNER row is protected (CM-09). An ACTIVE
 * target gets a scope version bump (CM-03) and a notification in the same transaction; INVITED
 * and PAUSED targets have no access and need neither. Access ends on the next request because
 * the actor is loaded from the database (ASVS v5.0.0-7.4.2).
 *
 * @param actor - Owner loaded from the path and checked for `update Collaboration`.
 * @param collaborationId - Collaboration from the path.
 * @throws 404 `NOT_FOUND` for an unknown, foreign or REVOKED row; 409 `OWNER_PROTECTED`.
 */
export async function revokeCollaborator(actor: Actor, collaborationId: string): Promise<void> {
  await runInTransaction(async (tx) => {
    const target = await findCollaborationWithPerson(tx, collaborationId, actor.organizationId);
    if (!target || target.status === 'REVOKED') throw httpError(404, 'NOT_FOUND', 'Not found');
    if (target.role === 'OWNER') {
      throw httpError(409, 'OWNER_PROTECTED', 'The owner cannot be revoked');
    }

    const revoked = await revokeCollaboration(tx, collaborationId, actor.organizationId);
    if (!revoked) throw httpError(404, 'NOT_FOUND', 'Not found');

    if (target.status === 'ACTIVE') {
      await bumpScopeVersion(target.personId, tx);
      const org = await findOrganization(actor.organizationId);
      if (!org) throw httpError(404, 'NOT_FOUND', 'Not found');
      const language = await recipientLanguage(target.personId, tx);
      await notify(
        {
          recipientId: target.personId,
          organizationId: actor.organizationId,
          sourceEvent: 'collaboration.revoked',
          content: language === 'EN' ? REVOKED_CONTENT.EN(org.name) : REVOKED_CONTENT.FR(org.name),
          related: { type: 'collaboration', id: revoked.id },
        },
        tx
      );
    }
  });
}

const OWNERSHIP_RECEIVED_CONTENT = {
  FR: (organizationName: string) => `Vous etes maintenant proprietaire de ${organizationName}.`,
  EN: (organizationName: string) => `You are now the owner of ${organizationName}.`,
};

const CONTACTS_REVIEW_CONTENT = {
  FR: (organizationName: string) =>
    `Les contacts publics de ${organizationName} restent en place. Revoyez-les dans les reglages.`,
  EN: (organizationName: string) =>
    `The public contacts of ${organizationName} stay in place. Review them in the settings.`,
};

const CONTACTS_REVIEW_MENTION = {
  FR: (slot: number | null) =>
    ` Le contact ${slot} est le numero de l'ancien proprietaire. Le garder ?`,
  EN: (slot: number | null) => ` Contact ${slot} is the former owner's number. Keep it?`,
};

/**
 * The owner hands the business to another ACTIVE collaborator: the target becomes OWNER and the
 * caller MANAGER, both scope versions are bumped (CM-03) and the new owner is notified, all in
 * one transaction so the organization keeps exactly one ACTIVE OWNER (C-05, CM-09; ASVS
 * v5.0.0-2.3.3). The caller is demoted first because the unique index allows one ACTIVE OWNER at
 * every statement; the deferred check only needs one at commit. `is_public_contact` is untouched.
 * The former owner's `amount_held`, when above 0, goes back to the business through an automatic
 * handover from and to themselves in the same transaction, so they restart at 0 (CM-18, FIN-017). The target is looked up inside the
 * actor's organization, so another business's row looks absent (ASVS v5.0.0-8.2.1).
 * When the business has a live public contact, the new owner also gets one
 * `organization.contacts_review` notice (CM-37). Contacts are never changed. A live PHONE contact
 * equal to the former owner's number adds a mention of its slot; the notice holds no number, name
 * or address (ASVS v5.0.0-16.2.5), and the former owner's email is never read.
 *
 * @param actor - Owner loaded from the path and checked for `transfer_ownership Organization`.
 * @param input - Validated body: gesture id and target collaboration.
 * @returns The target collaboration id.
 * @throws 400 `VALIDATION_ERROR` when the target is the caller; 404 `NOT_FOUND` for an unknown,
 * foreign, INVITED or REVOKED target; 403 `FORBIDDEN` when the caller stopped being OWNER meanwhile.
 */
export async function transferOwnership(
  actor: Actor,
  input: TransferOwnershipInput
): Promise<TransferOwnershipView> {
  const target = await runInTransaction(async (tx) => {
    const own = await findCollaboration(tx, actor.personId, actor.organizationId);
    if (own?.status !== 'ACTIVE' || own.role !== 'OWNER') {
      throw httpError(403, 'FORBIDDEN', 'Permission denied');
    }

    const row = await findCollaborationWithPerson(tx, input.collaboration_id, actor.organizationId);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Not found');
    if (row.id === own.id) {
      throw httpError(400, 'VALIDATION_ERROR', 'The new owner must be another collaborator');
    }
    if (row.status !== 'ACTIVE') throw httpError(404, 'NOT_FOUND', 'Not found');

    if (!(await demoteOwner(tx, actor.personId, actor.organizationId))) {
      throw httpError(403, 'FORBIDDEN', 'Permission denied');
    }
    if (!(await promoteToOwner(tx, row.id, actor.organizationId))) {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }

    await handOverFormerOwnerMoneyInTx(tx, {
      organizationId: actor.organizationId,
      formerOwnerId: actor.personId,
    });

    await bumpScopeVersion(actor.personId, tx);
    await bumpScopeVersion(row.personId, tx);

    const org = await findOrganization(actor.organizationId);
    if (!org) throw httpError(404, 'NOT_FOUND', 'Not found');
    const language = await recipientLanguage(row.personId, tx);
    await notify(
      {
        recipientId: row.personId,
        organizationId: actor.organizationId,
        sourceEvent: 'ownership.received',
        content:
          language === 'EN'
            ? OWNERSHIP_RECEIVED_CONTENT.EN(org.name)
            : OWNERSHIP_RECEIVED_CONTENT.FR(org.name),
        related: { type: 'collaboration', id: row.id },
      },
      tx
    );

    const contacts = await listLiveContacts(tx, actor.organizationId);
    if (contacts.length > 0) {
      const former = await findCollaborationWithPerson(tx, own.id, actor.organizationId);
      const formerNumber = former ? toPublicPerson(former.person).phone_number : null;
      const matching =
        formerNumber === null
          ? undefined
          : contacts.find((contact) => contact.kind === 'PHONE' && contact.value === formerNumber);
      const lang = language === 'EN' ? 'EN' : 'FR';
      await notify(
        {
          recipientId: row.personId,
          organizationId: actor.organizationId,
          sourceEvent: 'organization.contacts_review',
          content:
            CONTACTS_REVIEW_CONTENT[lang](org.name) +
            (matching ? CONTACTS_REVIEW_MENTION[lang](matching.slot) : ''),
          related: { type: 'organization', id: actor.organizationId },
        },
        tx
      );
    }
    return row;
  });

  logger.warn(
    {
      event: 'ownership_transferred',
      organizationId: actor.organizationId,
      formerOwnerId: actor.personId,
      newOwnerId: target.personId,
    },
    'Ownership transferred'
  );
  return { new_owner_collaboration_id: target.id };
}

const CLOSED_CONTENT = {
  FR: (organizationName: string) =>
    `${organizationName} est ferme: votre acces a l'equipe a ete retire.`,
  EN: (organizationName: string) =>
    `${organizationName} is closed: your access to the team was removed.`,
};

const ORDER_REFUSED_CONTENT = {
  FR: (organizationName: string) =>
    `Votre commande chez ${organizationName} a ete refusee: commerce ferme.`,
  EN: (organizationName: string) =>
    `Your order at ${organizationName} was refused: the business is closed.`,
};

/**
 * The owner closes the business (CM-10). In one transaction (ASVS v5.0.0-2.3.3) the organization
 * becomes CLOSED (only from ACTIVE), every non-owner ACTIVE or INVITED collaboration becomes
 * REVOKED (PAUSED ones too, silently) with `is_public_contact` false, ACTIVE ones get a scope version bump (CM-03) and an
 * `organization.closed` notification. The registered close hooks run last, in the same transaction, and a failing hook undoes
 * the whole close. Every PENDING order of the business is refused with the reason "Commerce fermé" (ORD-018)
 * and each registered customer gets an `order.status_changed` notification; CONFIRMED and later
 * orders are untouched. The owner's own collaboration, relations, balances and history are untouched. The
 * organization comes from the loaded actor, never from the body (ASVS v5.0.0-8.2.1).
 *
 * @param actor - Owner loaded from the path and checked for `close Organization`.
 * @param _input - Validated body; the gesture id is consumed by the idempotency layer.
 * @returns The new status.
 * @throws 409 `ORGANIZATION_NOT_ACTIVE` when SUSPENDED or CLOSED; 404 `NOT_FOUND` when absent.
 */
export async function closeOrganization(
  actor: Actor,
  _input: CloseOrganizationInput
): Promise<CloseOrganizationView> {
  const now = new Date();
  await runInTransaction(async (tx) => {
    if (!(await closeActiveOrganization(tx, actor.organizationId))) {
      const status = await findOrganizationStatus(actor.organizationId, tx);
      if (status === null) throw httpError(404, 'NOT_FOUND', 'Not found');
      throw httpError(409, 'ORGANIZATION_NOT_ACTIVE', 'Organization is not active');
    }

    const pending = await lockPendingOrders(tx, actor.organizationId);
    if (pending.length > 0) {
      const refused = await refusePendingOrders(tx, actor.organizationId, actor.personId);
      if (refused !== pending.length) {
        throw httpError(409, 'CONFLICT', 'Pending orders changed during the close');
      }
    }

    const revoked = await revokeNonOwnerCollaborations(tx, actor.organizationId);
    const needsName = revoked.length > 0 || pending.some((p) => p.customerRegistered);
    const org = needsName ? await findOrganization(actor.organizationId) : null;
    for (const order of pending) {
      // A guest customer has no account to notify (notify refuses them); the refusal still stands.
      if (!order.customerRegistered) continue;
      const language = await recipientLanguage(order.customerPersonId, tx);
      await notify(
        {
          recipientId: order.customerPersonId,
          organizationId: actor.organizationId,
          sourceEvent: 'order.status_changed',
          content:
            language === 'EN'
              ? ORDER_REFUSED_CONTENT.EN(org?.name ?? '')
              : ORDER_REFUSED_CONTENT.FR(org?.name ?? ''),
          related: { type: 'order', id: order.orderId },
        },
        tx
      );
    }

    for (const row of revoked) {
      await bumpScopeVersion(row.personId, tx);
      const language = await recipientLanguage(row.personId, tx);
      await notify(
        {
          recipientId: row.personId,
          organizationId: actor.organizationId,
          sourceEvent: 'organization.closed',
          content:
            language === 'EN'
              ? CLOSED_CONTENT.EN(org?.name ?? '')
              : CLOSED_CONTENT.FR(org?.name ?? ''),
          related: { type: 'collaboration', id: row.id },
        },
        tx
      );
    }

    await runCloseHooks(tx, actor.organizationId, now);
  });

  logger.warn(
    { event: 'organization_closed', organizationId: actor.organizationId, ownerId: actor.personId },
    'Organization closed'
  );
  return { status: 'CLOSED' };
}

/**
 * The owner reopens a closed business (CM-10). Only CLOSED becomes ACTIVE, in one conditional
 * update: a moderation suspension is never lifted here. The revoked team and the plans ended by
 * the close hooks are not restored; the owner invites and pays again. The organization comes
 * from the loaded actor, never from the body (ASVS v5.0.0-8.2.1).
 *
 * The update and the registered reopen hooks share one transaction, so a failing hook leaves the
 * business CLOSED (ASVS v5.0.0-2.3.3); a refused call runs no hook.
 *
 * @param actor - Owner loaded from the path and checked for `reopen Organization`.
 * @returns The new status.
 * @throws 409 `ORGANIZATION_NOT_CLOSED` when ACTIVE or SUSPENDED; 404 `NOT_FOUND` when absent.
 */
export async function reopenOrganization(actor: Actor): Promise<{ status: 'ACTIVE' }> {
  const now = new Date();
  await runInTransaction(async (tx) => {
    if (!(await reopenClosedOrganization(tx, actor.organizationId))) {
      const status = await findOrganizationStatus(actor.organizationId, tx);
      if (status === null) throw httpError(404, 'NOT_FOUND', 'Not found');
      throw httpError(409, 'ORGANIZATION_NOT_CLOSED', 'Organization is not closed');
    }
    await runReopenHooks(tx, actor.organizationId, now);
  });

  logger.warn(
    {
      event: 'organization_reopened',
      organizationId: actor.organizationId,
      ownerId: actor.personId,
    },
    'Organization reopened'
  );
  return { status: 'ACTIVE' };
}

/**
 * Finds the businesses that publish `phone` as a public contact number. Consumes the caller's
 * allowance of the shared `lookup:<personId>` key, the same as the person lookup, so neither can be
 * used to enumerate numbers (ASVS v5.0.0-2.4.1). A number that is not a public business number
 * gives an empty list (CM-26).
 *
 * @param personId - Authenticated caller.
 * @param phone - Normalized E.164 number.
 * @throws 429 `RATE_LIMITED` after 60 lookups in an hour.
 */
export async function lookupOrganizations(
  personId: string,
  phone: string
): Promise<{ items: OrganizationLookupItem[] }> {
  const allowance = await checkAndConsume(
    `lookup:${personId}`,
    LOOKUP_LIMIT,
    LOOKUP_WINDOW_SECONDS
  );
  if (!allowance.allowed) {
    logger.warn({ event: 'lookup_rate_limited', personId }, 'Lookup rate limited');
    throw httpError(429, 'RATE_LIMITED', 'Too many person lookups');
  }
  const found = await findOrganizationsByPublicNumber(phone);
  return {
    items: found.map((o) => ({ id: o.id, name: o.name, description: o.description })),
  };
}

/**
 * Lists the team of the actor's organization, REVOKED members included, newest invitation first.
 *
 * Only OWNER and MANAGER may read the list (others get 403). `amount_held` is field-level
 * restricted: present for the OWNER caller and on the caller's own row, absent elsewhere (ASVS
 * v5.0.0-8.2.3). The person goes through `toPublicPerson` and every field is listed explicitly,
 * so no email, language or credential leaves (ASVS v5.0.0-15.3.1).
 *
 * @param actor - Actor loaded from the path by `loadActor`.
 * @param query - Validated page size and cursor.
 * @returns A page of closed items and the next cursor.
 * @throws 403 `FORBIDDEN` for a SELLER or a DRIVER.
 */
export async function listCollaborators(
  actor: Actor,
  query: { limit: number; cursor?: string }
): Promise<{ items: CollaboratorItem[]; next_cursor: string | null }> {
  if (!atLeast(actor.role, 'MANAGER')) {
    logger.warn(
      {
        event: 'permission_refused',
        personId: actor.personId,
        action: 'list',
        subjectType: 'Team',
      },
      'Permission refused'
    );
    throw httpError(403, 'FORBIDDEN', 'Permission denied');
  }

  const { rows, nextCursor } = await listTeam(actor.organizationId, query);
  return {
    items: rows.map((row) => {
      const item: CollaboratorItem = {
        id: row.id,
        person: toPublicPerson(row.person),
        role: row.role,
        status: row.status,
        invited_at: row.invitedAt.toISOString(),
        accepted_at: row.acceptedAt ? row.acceptedAt.toISOString() : null,
      };
      if (actor.role === 'OWNER' || row.personId === actor.personId) {
        item.amount_held = Number(row.amountHeld);
      }
      return item;
    }),
    next_cursor: nextCursor,
  };
}
