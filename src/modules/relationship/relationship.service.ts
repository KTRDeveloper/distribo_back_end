import type { Prisma } from '@prisma/client';
import type { Actor } from '../../types/express.js';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  findActiveOwnerId,
  findOrganizationsByPublicNumber,
  runInTransaction,
} from '../organization/organization.repository.js';
import { checkAndConsume } from '../../lib/rate-limit.js';
import { listMyInvitations } from '../organization/organization.service.js';
import type { InvitationItem as TeamInvitationView } from '../organization/organization.schemas.js';
import { bumpScopeVersion, findOrCreateByPhone } from '../person/person.repository.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { atLeast, type Role } from '../../shared/access/roles.js';
import { subject } from '@casl/ability';
import { abilityFor } from '../../shared/access/ability.js';
import type {
  AddCounterInput,
  AddCustomerInput,
  ContestInput,
  CorrectNumberInput,
  EditCustomerInput,
  EditSupplierInput,
  InviteSupplierInput,
  ListInvitationsQuery,
  ListCustomersQuery,
  ListSuppliersQuery,
  SetCreditLimitInput,
} from './relationship.schemas.js';
import {
  acceptInvitationRow,
  counterLabelExists,
  createCounter,
  deleteInvitationRow,
  ensureCustomerRelationship,
  findActiveRole,
  findInvitationLocked,
  findPersonName,
  findCustomerRelationshipLocked,
  findOrganizationSupplierLocked,
  findSupplierRelationship,
  findSupplierRelationshipLocked,
  findWithParties,
  findActivePhoneNumber,
  findWithSupplier,
  hasContested,
  insertGhostPerson,
  insertInvitation,
  insertReassignment,
  listOwnerAndManagerIds,
  repointCustomerPerson,
  listAttachedRelationships,
  listInvitationRows,
  listCreditLimitChangeRows,
  listCustomerRelationships,
  listOrganizationSuppliers,
  listSupplierRelationships,
  liveRelationshipExists,
  lockOrganization,
  managesOrganization,
  transitionRelationship,
  updateOrganizationSupplierLabel,
  updateSupplierFields,
  updateSupplierLabel,
  writeCreditLimit,
} from './relationship.repository.js';
import {
  projectForCustomer,
  projectForSupplier,
  projectInvitation,
  type CustomerRelationshipView,
  type SupplierInvitationView,
  type SupplierRelationshipView,
} from './relationship.visibility.js';

const ADDED_CONTENT = {
  FR: (organizationName: string) => `${organizationName} vous a ajoute comme client.`,
  EN: (organizationName: string) => `${organizationName} added you as a customer.`,
};

/**
 * A seller adds a customer by phone number to the actor's organization.
 *
 * One transaction (ASVS v5.0.0-2.3.3): the organization must be ACTIVE, the person is found or
 * created as a guest, the relationship is ensured (ACTIVE, limit 0, balance 0, author = caller),
 * and a registered customer is notified `customer.added` only when the relationship is new. The
 * organization, the caller and the role come from the loaded actor, never from the body.
 *
 * @param actor - Actor loaded from the path and checked for `create CustomerRelationship`.
 * @param input - Validated body: gesture id, E.164 number, optional label and address.
 * @returns `created: false` when a live relationship already existed (the route answers 200).
 * @throws 409 `ORGANIZATION_NOT_ACTIVE`.
 */
export function addCustomer(
  actor: Actor,
  input: AddCustomerInput
): Promise<{ created: boolean; relationship: SupplierRelationshipView }> {
  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);

    const person = await findOrCreateByPhone(input.phone_number, tx);
    const { relationship, created } = await ensureCustomerRelationship(tx, {
      supplierOrganizationId: actor.organizationId,
      customerPersonId: person.id,
      createdById: actor.personId,
      customerLabel: input.customer_label,
      deliveryAddress: input.delivery_address,
    });

    const row = await findWithParties(tx, relationship.id);
    if (created && person.registeredAt !== null) {
      const language = await recipientLanguage(person.id, tx);
      const name = row.supplierOrganization?.name ?? '';
      await notify(
        {
          recipientId: person.id,
          organizationId: actor.organizationId,
          sourceEvent: 'customer.added',
          content: language === 'EN' ? ADDED_CONTENT.EN(name) : ADDED_CONTENT.FR(name),
          related: { type: 'customer_relationship', id: relationship.id },
        },
        tx
      );
    }

    return { created, relationship: projectForSupplier(row) };
  });
}

/** Refuses a role below SELLER with a logged 403 (deny by default, v5.0.0-8.2.1). */
function assertSellerOrAbove(actor: Actor, action: string): void {
  if (atLeast(actor.role, 'SELLER')) return;
  logger.warn(
    {
      event: 'permission_refused',
      personId: actor.personId,
      action,
      subjectType: 'CustomerRelationship',
    },
    'Permission refused'
  );
  throw httpError(403, 'FORBIDDEN', 'Permission denied');
}

/**
 * A SELLER or above lists the organization's customers and counters, newest first.
 *
 * The organization comes from the loaded actor; rows go through the visibility predicate and the
 * supplier projection, so `customer_label` and `supplier_notes` are returned and `supplier_label`
 * never is (CM-19, v5.0.0-15.3.1).
 *
 * @param actor - Actor loaded from the path.
 * @param query - Validated page size, cursor and filters.
 * @returns A page of supplier views and the next cursor, or null on the last page.
 * @throws 403 `FORBIDDEN` for a DRIVER; 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listCustomers(
  actor: Actor,
  query: ListCustomersQuery
): Promise<{ items: SupplierRelationshipView[]; next_cursor: string | null }> {
  assertSellerOrAbove(actor, 'list');

  const { rows, nextCursor } = await listSupplierRelationships(actor, query);
  return { items: rows.map(projectForSupplier), next_cursor: nextCursor };
}

/**
 * A signed-in person lists their suppliers: the relationships where they are the customer person
 * (ACTIVE, ENDED and the PENDING invitations they sent), newest first.
 *
 * The filter is the visibility predicate for the caller's person id, taken from the session
 * (v5.0.0-8.2.2). Each row goes through `projectForCustomer`, so `customer_label` and
 * `supplier_notes` are never sent (CM-19, v5.0.0-15.3.1).
 *
 * @param personId - Caller's person id from the session.
 * @param query - Validated page size, cursor and optional status.
 * @returns A page of customer views and the next cursor, or null on the last page.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listSuppliersOfPerson(
  personId: string,
  query: ListSuppliersQuery
): Promise<{ items: CustomerRelationshipView[]; next_cursor: string | null }> {
  const { rows, nextCursor } = await listCustomerRelationships(personId, query);
  return { items: rows.map(projectForCustomer), next_cursor: nextCursor };
}

/**
 * A SELLER or above opens one customer of the actor's organization (supplier view).
 *
 * The row is selected by id and the visibility predicate together, narrowed to the actor's
 * organization as supplier (v5.0.0-8.2.2): an id of another business, a deleted or a merged
 * relationship answers 404 and never confirms the id exists. The projection omits
 * `supplier_label` (CM-19, v5.0.0-15.3.1).
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @throws 403 `FORBIDDEN` for a DRIVER; 404 `NOT_FOUND` when no visible relationship matches.
 */
export async function getCustomer(
  actor: Actor,
  relationshipId: string
): Promise<SupplierRelationshipView> {
  assertSellerOrAbove(actor, 'read');

  const row = await findSupplierRelationship(actor, relationshipId);
  if (!row) throw httpError(404, 'NOT_FOUND', 'Customer not found');
  return projectForSupplier(row);
}

const EDIT_CONTEXT = { onServer: false, online: true, daysSinceSync: 0 } as const;

/**
 * A SELLER or above edits the supplier-side fields of one customer of the actor's organization.
 *
 * Every field sent is checked against the rules table (ASVS v5.0.0-8.2.3): one refused field
 * answers 403 and nothing is written. The row is then selected by id and the visibility
 * predicate together (404 outside the organization, v5.0.0-8.2.2). Only `customer_label`,
 * `delivery_address` and `supplier_notes` can reach the update (CM-19, CWE-915); the response is
 * the supplier projection.
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @param input - Validated body with at least one field.
 * @throws 403 `FORBIDDEN` when the role may not update a field sent; 404 `NOT_FOUND`.
 */
export async function editCustomer(
  actor: Actor,
  relationshipId: string,
  input: EditCustomerInput
): Promise<SupplierRelationshipView> {
  const ability = abilityFor(actor.role, EDIT_CONTEXT);
  const fields = Object.keys(input);
  if (!fields.every((field) => ability.can('update', 'CustomerRelationship', field))) {
    logger.warn(
      {
        event: 'permission_refused',
        personId: actor.personId,
        action: 'update',
        subjectType: 'CustomerRelationship',
      },
      'Permission refused'
    );
    throw httpError(403, 'FORBIDDEN', 'Permission denied');
  }

  const row = await updateSupplierFields(actor, relationshipId, {
    customerLabel: input.customer_label,
    deliveryAddress: input.delivery_address,
    supplierNotes: input.supplier_notes,
  });
  if (!row) throw httpError(404, 'NOT_FOUND', 'Customer not found');
  return projectForSupplier(row);
}

const ADD_COUNTER_CONTEXT = { onServer: false, online: true, daysSinceSync: 0 } as const;

/**
 * A manager adds a named counter to the actor's organization.
 *
 * Two checks decide access (ASVS v5.0.0-8.2.1, deny by default): the rules table with the subject
 * `{ counter: true }` (ACC-002, Q-029) and a MANAGER rank. The rank check stays because the
 * SELLER rule `create CustomerRelationship` carries no condition and would also match a counter.
 * One transaction: the organization must be ACTIVE and is locked, so two concurrent adds of one
 * label cannot both pass the uniqueness check. The counter has no customer, limit 0 (C-06, C-10).
 * The organization, the caller and the role come from the loaded actor, never from the body.
 *
 * @param actor - Actor loaded from the path.
 * @param input - Validated body: gesture id and label.
 * @throws 403 `FORBIDDEN`; 409 `ORGANIZATION_NOT_ACTIVE`; 409 `COUNTER_LABEL_TAKEN`.
 */
export async function addCounter(
  actor: Actor,
  input: AddCounterInput
): Promise<SupplierRelationshipView> {
  const allowed =
    atLeast(actor.role, 'MANAGER') &&
    abilityFor(actor.role, ADD_COUNTER_CONTEXT).can(
      'create',
      subject('CustomerRelationship', { counter: true })
    );
  if (!allowed) {
    logger.warn(
      {
        event: 'permission_refused',
        personId: actor.personId,
        action: 'create',
        subjectType: 'CustomerRelationship',
      },
      'Permission refused'
    );
    throw httpError(403, 'FORBIDDEN', 'Permission denied');
  }

  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    await lockOrganization(tx, actor.organizationId);
    if (await counterLabelExists(tx, actor.organizationId, input.customer_label)) {
      throw httpError(409, 'COUNTER_LABEL_TAKEN', 'A counter with this label already exists');
    }
    const counter = await createCounter(tx, {
      supplierOrganizationId: actor.organizationId,
      label: input.customer_label,
      createdById: actor.personId,
    });
    return projectForSupplier(await findWithParties(tx, counter.id));
  });
}

const CREDIT_LIMIT_CONTEXT = { onServer: false, online: true, daysSinceSync: 0 } as const;

const RAISED_CONTENT = {
  FR: (author: string, customer: string, limit: string) =>
    `${author} a relevé le plafond de ${customer} à ${limit}.`,
  EN: (author: string, customer: string, limit: string) =>
    `${author} raised the credit limit of ${customer} to ${limit}.`,
};

/** True when the new limit is higher than the old one; an empty limit (no ceiling) is the highest. */
function isRaise(previous: bigint | null, next: bigint | null): boolean {
  if (previous === null) return false;
  return next === null || next > previous;
}

function refuse(actor: Actor, event: 'permission_refused' | 'own_record_refused'): never {
  logger.warn(
    { event, personId: actor.personId, action: 'update', subjectType: 'CustomerRelationship' },
    'Permission refused'
  );
  if (event === 'own_record_refused') {
    throw httpError(403, 'OWN_RECORD', 'Not allowed on your own record');
  }
  throw httpError(403, 'FORBIDDEN', 'Permission denied');
}

/**
 * An owner, or a manager online, sets the credit limit of one customer of the actor's organization.
 *
 * The rules table decides first (`update` on the field `credit_limit`, ASVS v5.0.0-8.2.1): a
 * SELLER or DRIVER answers 403. One transaction then locks the row selected by id and the
 * visibility predicate together (404 outside the organization, v5.0.0-8.2.2) and checks, in order:
 * a counter (409 `COUNTER_NO_CREDIT`), the caller's own record (403 `OWN_RECORD`: the caller is
 * the customer person, or, below OWNER, manages the customer organization), and an ACTIVE status
 * (409 `RELATIONSHIP_NOT_ACTIVE`). The limit, its author (always the caller) and its time are
 * written together and the database journal trigger adds the `CreditLimitChange` row (C-10,
 * v5.0.0-2.3.3). Setting the current value again writes nothing. A MANAGER raising a limit
 * notifies the owner `credit_limit.raised` in the same transaction.
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @param input - Validated body: gesture id and the new limit (null: no ceiling).
 * @returns The supplier view of the relationship.
 * @throws 403 `FORBIDDEN` or `OWN_RECORD`; 404 `NOT_FOUND`; 409 `COUNTER_NO_CREDIT` or
 * `RELATIONSHIP_NOT_ACTIVE`.
 */
export async function setCreditLimit(
  actor: Actor,
  relationshipId: string,
  input: SetCreditLimitInput
): Promise<SupplierRelationshipView> {
  if (
    !abilityFor(actor.role, CREDIT_LIMIT_CONTEXT).can(
      'update',
      'CustomerRelationship',
      'credit_limit'
    )
  ) {
    refuse(actor, 'permission_refused');
  }

  return runInTransaction(async (tx) => {
    const row = await findSupplierRelationshipLocked(tx, actor, relationshipId);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Customer not found');

    if (row.customerPersonId === null && row.customerOrganizationId === null) {
      throw httpError(409, 'COUNTER_NO_CREDIT', 'A counter has no credit');
    }
    // Own-record gestures return to the owner: only a customer person equal to the caller binds
    // an owner; a manager is also bound by a customer organization they manage.
    const ownPerson = row.customerPersonId === actor.personId;
    const managesCustomer =
      actor.role !== 'OWNER' &&
      row.customerOrganizationId !== null &&
      (await managesOrganization(tx, actor.personId, row.customerOrganizationId));
    if (ownPerson || managesCustomer) refuse(actor, 'own_record_refused');
    if (row.status !== 'ACTIVE') {
      throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'The relationship is not active');
    }

    const previous = row.creditLimit;
    const next = input.credit_limit === null ? null : BigInt(input.credit_limit);
    if (previous === next) return projectForSupplier(row);

    await writeCreditLimit(tx, row.id, {
      creditLimit: next,
      setById: actor.personId,
      clearAuthorFirst: row.creditLimitSetById === actor.personId,
    });
    logger.warn(
      {
        event: 'credit_limit_changed',
        relationshipId: row.id,
        authorId: actor.personId,
        previousLimit: previous === null ? null : Number(previous),
        newLimit: next === null ? null : Number(next),
      },
      'Credit limit changed'
    );

    if (actor.role === 'MANAGER' && isRaise(previous, next)) {
      const customer =
        row.customerPerson?.fullName ?? row.customerOrganization?.name ?? row.customerLabel ?? '';
      await notifyOwnerOfRaise(tx, actor, { id: row.id, customer }, next);
    }
    return projectForSupplier(await findWithParties(tx, row.id));
  });
}

/** Tells the organization's owner that a manager raised a limit, in the owner's language. */
async function notifyOwnerOfRaise(
  tx: Prisma.TransactionClient,
  actor: Actor,
  target: { id: string; customer: string },
  limit: bigint | null
): Promise<void> {
  const ownerId = await findActiveOwnerId(tx, actor.organizationId);
  if (ownerId === null) return;
  const language = await recipientLanguage(ownerId, tx);
  const author = (await findPersonName(tx, actor.personId)) ?? '';
  let amount = limit?.toString() ?? '';
  if (limit === null) amount = language === 'EN' ? 'no ceiling' : 'sans plafond';
  const text = language === 'EN' ? RAISED_CONTENT.EN : RAISED_CONTENT.FR;
  await notify(
    {
      recipientId: ownerId,
      organizationId: actor.organizationId,
      sourceEvent: 'credit_limit.raised',
      content: text(author, target.customer, amount),
      related: { type: 'customer_relationship', id: target.id },
    },
    tx
  );
}

/** One credit limit journal entry as the API returns it (an empty limit means no ceiling). */
export interface CreditLimitChangeView {
  previous_limit: number | null;
  new_limit: number | null;
  set_by_id: string;
  set_at: string;
}

/**
 * An OWNER or a MANAGER reads the credit limit history of one customer, newest first.
 *
 * The role is checked first (ASVS v5.0.0-8.2.1): a SELLER or DRIVER answers 403 and the event is
 * logged. The relationship is then loaded through the visibility predicate (v5.0.0-8.2.2), so a
 * relationship of another business answers 404 and never confirms the id exists. The response is
 * built from an explicit list of fields (v5.0.0-15.3.1).
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @param query - Validated page size and cursor.
 * @returns A page of journal entries and the next cursor, or null on the last page.
 * @throws 403 `FORBIDDEN`; 404 `NOT_FOUND`; 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listCreditLimitChanges(
  actor: Actor,
  relationshipId: string,
  query: { limit: number; cursor?: string }
): Promise<{ items: CreditLimitChangeView[]; next_cursor: string | null }> {
  if (!atLeast(actor.role, 'MANAGER')) {
    logger.warn(
      {
        event: 'permission_refused',
        personId: actor.personId,
        action: 'read',
        subjectType: 'CreditLimitChange',
      },
      'Permission refused'
    );
    throw httpError(403, 'FORBIDDEN', 'Permission denied');
  }

  const page = await listCreditLimitChangeRows(actor, relationshipId, query);
  if (!page) throw httpError(404, 'NOT_FOUND', 'Customer not found');
  return {
    items: page.rows.map((row) => ({
      previous_limit: row.previousLimit === null ? null : Number(row.previousLimit),
      new_limit: row.newLimit === null ? null : Number(row.newLimit),
      set_by_id: row.setById,
      set_at: row.setAt.toISOString(),
    })),
    next_cursor: page.nextCursor,
  };
}

const END_REOPEN_CONTEXT = { onServer: false, online: true, daysSinceSync: 0 } as const;

/** Refuses a caller whose role lacks `end` or `reopen` on a relationship, with a logged 403. */
function assertMayEndOrReopen(actor: Actor, action: 'end' | 'reopen'): void {
  if (abilityFor(actor.role, END_REOPEN_CONTEXT).can(action, 'CustomerRelationship')) return;
  logger.warn(
    {
      event: 'permission_refused',
      personId: actor.personId,
      action,
      subjectType: 'CustomerRelationship',
    },
    'Permission refused'
  );
  throw httpError(403, 'FORBIDDEN', 'Permission denied');
}

/**
 * A manager (or owner) ends a customer relationship as supplier: ACTIVE becomes ENDED with
 * `ended_by_party` SUPPLIER. History, balance and payments stay untouched.
 *
 * The rules table decides first (`end`, online only, ASVS v5.0.0-8.2.1). One transaction then locks
 * the row selected by id and the visibility predicate together (404 outside the organization,
 * v5.0.0-8.2.2), refuses a counter and any status but ACTIVE, and writes the change in one
 * conditional update (v5.0.0-2.3.1, C-09).
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @returns The supplier view of the ended relationship.
 * @throws 403 `FORBIDDEN`; 404 `NOT_FOUND`; 409 `COUNTER_CANNOT_END` or `RELATIONSHIP_NOT_ACTIVE`.
 */
export async function endRelationship(
  actor: Actor,
  relationshipId: string
): Promise<SupplierRelationshipView> {
  assertMayEndOrReopen(actor, 'end');

  return runInTransaction(async (tx) => {
    const row = await findSupplierRelationshipLocked(tx, actor, relationshipId);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Customer not found');
    if (row.customerPersonId === null && row.customerOrganizationId === null) {
      throw httpError(409, 'COUNTER_CANNOT_END', 'A counter cannot be ended');
    }
    if (row.status !== 'ACTIVE') {
      throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'The relationship is not active');
    }

    const changed = await transitionRelationship(tx, row.id, {
      from: { status: 'ACTIVE', endedByParty: null },
      to: { status: 'ENDED', endedByParty: 'SUPPLIER' },
    });
    if (!changed) throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'The relationship is not active');
    logger.warn(
      { event: 'relationship_ended', relationshipId: row.id, personId: actor.personId },
      'Relationship ended'
    );
    return projectForSupplier(await findWithParties(tx, row.id));
  });
}

/**
 * A manager (or owner) reopens a relationship the supplier ended: ENDED by SUPPLIER becomes ACTIVE
 * with `ended_by_party` empty. Only the party that closed it may reopen it (C-09): a relationship
 * ended by the customer answers 409 and stays ENDED.
 *
 * Same access checks, lock and conditional update as {@link endRelationship}.
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @returns The supplier view of the reopened relationship.
 * @throws 403 `FORBIDDEN`; 404 `NOT_FOUND`; 409 `ENDED_BY_OTHER_PARTY` or `RELATIONSHIP_NOT_ENDED`.
 */
export async function reopenRelationship(
  actor: Actor,
  relationshipId: string
): Promise<SupplierRelationshipView> {
  assertMayEndOrReopen(actor, 'reopen');

  return runInTransaction(async (tx) => {
    const row = await findSupplierRelationshipLocked(tx, actor, relationshipId);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Customer not found');
    if (row.status !== 'ENDED') {
      throw httpError(409, 'RELATIONSHIP_NOT_ENDED', 'The relationship is not ended');
    }
    if (row.endedByParty !== 'SUPPLIER') {
      logger.warn(
        { event: 'reopen_refused', relationshipId: row.id, personId: actor.personId },
        'Reopen refused: ended by the other party'
      );
      throw httpError(409, 'ENDED_BY_OTHER_PARTY', 'The other party ended this relationship');
    }

    const changed = await transitionRelationship(tx, row.id, {
      from: { status: 'ENDED', endedByParty: 'SUPPLIER' },
      to: { status: 'ACTIVE', endedByParty: null },
    });
    if (!changed) throw httpError(409, 'RELATIONSHIP_NOT_ENDED', 'The relationship is not ended');
    return projectForSupplier(await findWithParties(tx, row.id));
  });
}

/**
 * A customer names a supplier: writes `supplier_label` on a relationship of the caller.
 *
 * The row is selected by id and by the caller's person id as customer (ASVS v5.0.0-8.2.2): a
 * relationship of another person, or one where the caller is only the supplier, answers 404.
 * Only `supplier_label` is writable (v5.0.0-15.3.3); the response is the customer projection, so
 * `customer_label` and `supplier_notes` never leave (CM-19).
 *
 * @param personId - Caller's person id from the session.
 * @param relationshipId - Validated relationship id from the path.
 * @param input - Validated body: the label.
 * @throws 404 `NOT_FOUND`.
 */
export async function customerEditSupplier(
  personId: string,
  relationshipId: string,
  input: EditSupplierInput
): Promise<CustomerRelationshipView> {
  const row = await updateSupplierLabel(personId, relationshipId, input.supplier_label);
  if (!row) throw httpError(404, 'NOT_FOUND', 'Supplier not found');
  return projectForCustomer(row);
}

/**
 * A customer leaves a supplier: ACTIVE becomes ENDED with `ended_by_party` CUSTOMER. History,
 * balance and payments stay untouched.
 *
 * One transaction locks the row selected by id and the caller's person id as customer (404
 * otherwise, v5.0.0-8.2.2), refuses any status but ACTIVE, and writes the change in one
 * conditional update (v5.0.0-2.3.1, C-09).
 *
 * @param personId - Caller's person id from the session.
 * @param relationshipId - Validated relationship id from the path.
 * @returns The customer view of the ended relationship.
 * @throws 404 `NOT_FOUND`; 409 `RELATIONSHIP_NOT_ACTIVE`.
 */
export function customerEndRelationship(
  personId: string,
  relationshipId: string
): Promise<CustomerRelationshipView> {
  return runInTransaction(async (tx) => {
    const row = await findCustomerRelationshipLocked(tx, personId, relationshipId);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Supplier not found');
    if (row.status !== 'ACTIVE') {
      throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'The relationship is not active');
    }

    const changed = await transitionRelationship(tx, row.id, {
      from: { status: 'ACTIVE', endedByParty: null },
      to: { status: 'ENDED', endedByParty: 'CUSTOMER' },
    });
    if (!changed) throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'The relationship is not active');
    logger.warn(
      { event: 'relationship_ended', relationshipId: row.id, personId },
      'Relationship ended'
    );
    return projectForCustomer(await findWithSupplier(tx, row.id));
  });
}

/**
 * A customer comes back to a supplier they left: ENDED by CUSTOMER becomes ACTIVE with
 * `ended_by_party` empty. Only the party that closed it may reopen it (C-09): a relationship the
 * supplier ended (a block) answers 409 and stays ENDED.
 *
 * Same scope, lock and conditional update as {@link customerEndRelationship}.
 *
 * @param personId - Caller's person id from the session.
 * @param relationshipId - Validated relationship id from the path.
 * @returns The customer view of the reopened relationship.
 * @throws 404 `NOT_FOUND`; 409 `ENDED_BY_OTHER_PARTY` or `RELATIONSHIP_NOT_ENDED`.
 */
export function customerReopenRelationship(
  personId: string,
  relationshipId: string
): Promise<CustomerRelationshipView> {
  return runInTransaction(async (tx) => {
    const row = await findCustomerRelationshipLocked(tx, personId, relationshipId);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Supplier not found');
    if (row.status !== 'ENDED') {
      throw httpError(409, 'RELATIONSHIP_NOT_ENDED', 'The relationship is not ended');
    }
    if (row.endedByParty !== 'CUSTOMER') {
      logger.warn(
        { event: 'reopen_refused', relationshipId: row.id, personId },
        'Reopen refused: ended by the other party'
      );
      throw httpError(409, 'ENDED_BY_OTHER_PARTY', 'The other party ended this relationship');
    }

    const changed = await transitionRelationship(tx, row.id, {
      from: { status: 'ENDED', endedByParty: 'CUSTOMER' },
      to: { status: 'ACTIVE', endedByParty: null },
    });
    if (!changed) throw httpError(409, 'RELATIONSHIP_NOT_ENDED', 'The relationship is not ended');
    return projectForCustomer(await findWithSupplier(tx, row.id));
  });
}

/** Refuses a role below MANAGER with a logged 403 (deny by default, v5.0.0-8.2.1). */
function assertManagerOrAbove(actor: Actor, action: string): void {
  if (atLeast(actor.role, 'MANAGER')) return;
  logger.warn(
    {
      event: 'permission_refused',
      personId: actor.personId,
      action,
      subjectType: 'CustomerRelationship',
    },
    'Permission refused'
  );
  throw httpError(403, 'FORBIDDEN', 'Permission denied');
}

/**
 * An OWNER or a MANAGER lists the suppliers of the actor's organization: the relationships where
 * it is the customer organization, newest first.
 *
 * The organization comes from the loaded actor, never from the client (v5.0.0-8.2.2). Each row
 * goes through `projectForCustomer`, so `customer_label` and `supplier_notes` are never sent
 * (CM-19, v5.0.0-15.3.1).
 *
 * @param actor - Actor loaded from the path.
 * @param query - Validated page size, cursor and optional status.
 * @returns A page of customer views and the next cursor, or null on the last page.
 * @throws 403 `FORBIDDEN` below MANAGER; 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listSuppliersOfOrganization(
  actor: Actor,
  query: ListSuppliersQuery
): Promise<{ items: CustomerRelationshipView[]; next_cursor: string | null }> {
  assertManagerOrAbove(actor, 'list');

  const { rows, nextCursor } = await listOrganizationSuppliers(actor, query);
  return { items: rows.map(projectForCustomer), next_cursor: nextCursor };
}

/**
 * An OWNER or a MANAGER names a supplier of the actor's organization: writes `supplier_label` on a
 * relationship where the organization is the customer organization.
 *
 * The row is selected by id, visibility and customer organization together (v5.0.0-8.2.2): a
 * relationship of another business answers 404. Only `supplier_label` is writable
 * (v5.0.0-15.3.3, CM-19); the response is the customer projection.
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @param input - Validated body: the label.
 * @throws 403 `FORBIDDEN` below MANAGER; 404 `NOT_FOUND`.
 */
export async function orgEditSupplier(
  actor: Actor,
  relationshipId: string,
  input: EditSupplierInput
): Promise<CustomerRelationshipView> {
  assertManagerOrAbove(actor, 'update');

  const row = await updateOrganizationSupplierLabel(actor, relationshipId, input.supplier_label);
  if (!row) throw httpError(404, 'NOT_FOUND', 'Supplier not found');
  return projectForCustomer(row);
}

/**
 * A manager (or owner) leaves a supplier on behalf of the organization: ACTIVE becomes ENDED with
 * `ended_by_party` CUSTOMER. History, balance and payments stay untouched.
 *
 * The rules table decides first (`end`, online only, ASVS v5.0.0-8.2.1). One transaction then
 * locks the row selected by id, visibility and customer organization together (404 outside the
 * organization, v5.0.0-8.2.2), refuses any status but ACTIVE, and writes the change in one
 * conditional update (v5.0.0-2.3.1, C-09). The response is the customer projection (CM-19).
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @returns The customer view of the ended relationship.
 * @throws 403 `FORBIDDEN`; 404 `NOT_FOUND`; 409 `RELATIONSHIP_NOT_ACTIVE`.
 */
export async function orgEndSupplier(
  actor: Actor,
  relationshipId: string
): Promise<CustomerRelationshipView> {
  assertMayEndOrReopen(actor, 'end');

  return runInTransaction(async (tx) => {
    const row = await findOrganizationSupplierLocked(tx, actor, relationshipId);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Supplier not found');
    if (row.status !== 'ACTIVE') {
      throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'The relationship is not active');
    }

    const changed = await transitionRelationship(tx, row.id, {
      from: { status: 'ACTIVE', endedByParty: null },
      to: { status: 'ENDED', endedByParty: 'CUSTOMER' },
    });
    if (!changed) throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'The relationship is not active');
    logger.warn(
      { event: 'relationship_ended', relationshipId: row.id, personId: actor.personId },
      'Relationship ended'
    );
    return projectForCustomer(await findWithSupplier(tx, row.id));
  });
}

/**
 * A manager (or owner) brings the organization back to a supplier it left: ENDED by CUSTOMER
 * becomes ACTIVE with `ended_by_party` empty. Only the party that closed it may reopen it (C-09):
 * a relationship the supplier ended (a block) answers 409 and stays ENDED.
 *
 * Same access checks, lock and conditional update as {@link orgEndSupplier}.
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @returns The customer view of the reopened relationship.
 * @throws 403 `FORBIDDEN`; 404 `NOT_FOUND`; 409 `ENDED_BY_OTHER_PARTY` or `RELATIONSHIP_NOT_ENDED`.
 */
export async function orgReopenSupplier(
  actor: Actor,
  relationshipId: string
): Promise<CustomerRelationshipView> {
  assertMayEndOrReopen(actor, 'reopen');

  return runInTransaction(async (tx) => {
    const row = await findOrganizationSupplierLocked(tx, actor, relationshipId);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Supplier not found');
    if (row.status !== 'ENDED') {
      throw httpError(409, 'RELATIONSHIP_NOT_ENDED', 'The relationship is not ended');
    }
    if (row.endedByParty !== 'CUSTOMER') {
      logger.warn(
        { event: 'reopen_refused', relationshipId: row.id, personId: actor.personId },
        'Reopen refused: ended by the other party'
      );
      throw httpError(409, 'ENDED_BY_OTHER_PARTY', 'The other party ended this relationship');
    }

    const changed = await transitionRelationship(tx, row.id, {
      from: { status: 'ENDED', endedByParty: 'CUSTOMER' },
      to: { status: 'ACTIVE', endedByParty: null },
    });
    if (!changed) throw httpError(409, 'RELATIONSHIP_NOT_ENDED', 'The relationship is not ended');
    return projectForCustomer(await findWithSupplier(tx, row.id));
  });
}

const LOOKUP_LIMIT = 60;
const LOOKUP_WINDOW_SECONDS = 3600;
const INVITE_CONTEXT = { onServer: false, online: true, daysSinceSync: 0 } as const;

/**
 * A customer invites a supplier by phone number: a PENDING relationship whose supplier is a
 * person (found or created as a guest), with credit limit 0 (C-06, C-08, C-10). No message is
 * sent; the customer sends the invitation from their own phone.
 *
 * The customer is the organization when `viewer.organizationId` is set (then the rules table must
 * allow `invite_supplier`, MANAGER and above, online only, ASVS v5.0.0-8.2.1), else the person.
 * Both come from the session and the path, never from the body. Each call consumes one unit of the
 * shared `lookup:<personId>` allowance (60 an hour, ASVS v5.0.0-2.4.1) because it tells whether a
 * number belongs to someone. In one transaction (v5.0.0-2.3.3) the number must not be a public
 * number of an organization, and no live relationship may exist for the pair; a refusal rolls back
 * the guest created for the number, so nothing is stored.
 *
 * @param viewer - Person from the session; organization and role from the loaded actor, if any.
 * @param input - Validated body: gesture id, E.164 number and supplier label.
 * @returns The customer view of the new relationship.
 * @throws 403 `FORBIDDEN`; 429 `RATE_LIMITED`; 409 `NUMBER_IS_ORGANIZATION` or
 * `RELATIONSHIP_EXISTS`; 409 `ORGANIZATION_NOT_ACTIVE`.
 */
export async function inviteSupplier(
  viewer: { personId: string; organizationId?: string; role?: Role },
  input: InviteSupplierInput
): Promise<CustomerRelationshipView> {
  if (viewer.organizationId !== undefined) {
    const allowed =
      viewer.role !== undefined &&
      abilityFor(viewer.role, INVITE_CONTEXT).can('invite_supplier', 'CustomerRelationship');
    if (!allowed) {
      logger.warn(
        {
          event: 'permission_refused',
          personId: viewer.personId,
          action: 'invite_supplier',
          subjectType: 'CustomerRelationship',
        },
        'Permission refused'
      );
      throw httpError(403, 'FORBIDDEN', 'Permission denied');
    }
  }

  const allowance = await checkAndConsume(
    `lookup:${viewer.personId}`,
    LOOKUP_LIMIT,
    LOOKUP_WINDOW_SECONDS
  );
  if (!allowance.allowed) {
    logger.warn({ event: 'lookup_rate_limited', personId: viewer.personId }, 'Lookup rate limited');
    throw httpError(429, 'RATE_LIMITED', 'Too many lookups');
  }

  const organizationId = viewer.organizationId;
  return runInTransaction(async (tx) => {
    if (organizationId !== undefined) await assertOrganizationActive(organizationId, tx);

    if ((await findOrganizationsByPublicNumber(input.phone_number)).length > 0) {
      throw httpError(409, 'NUMBER_IS_ORGANIZATION', 'This number belongs to an organization');
    }

    const supplier = await findOrCreateByPhone(input.phone_number, tx);
    const id = await insertInvitation(tx, {
      supplierPersonId: supplier.id,
      customerPersonId: organizationId === undefined ? viewer.personId : undefined,
      customerOrganizationId: organizationId,
      supplierLabel: input.supplier_label,
      createdById: viewer.personId,
    });
    if (id === null) {
      throw httpError(409, 'RELATIONSHIP_EXISTS', 'A relationship with this supplier exists');
    }
    return projectForCustomer(await findWithSupplier(tx, id));
  });
}

/**
 * A person lists the PENDING invitations addressed to them as supplier: newest first, each with
 * the label and the customer's public view only (v5.0.0-8.2.3). The person comes from the session.
 *
 * @param personId - Caller's person id from the session.
 * @param query - Validated page size and cursor.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listSupplierInvitations(
  personId: string,
  query: ListInvitationsQuery
): Promise<{ items: SupplierInvitationView[]; next_cursor: string | null }> {
  const { rows, nextCursor } = await listInvitationRows(personId, query);
  return { items: rows.map(projectInvitation), next_cursor: nextCursor };
}

const ANSWER_CONTENT = {
  'supplier.accepted': {
    FR: (name: string) => `${name} a accepte votre invitation.`,
    EN: (name: string) => `${name} accepted your invitation.`,
  },
  'supplier.declined': {
    FR: (name: string) => `${name} a refuse votre invitation.`,
    EN: (name: string) => `${name} declined your invitation.`,
  },
} as const;

/**
 * Tells the customer of an invitation how it was answered, in the recipient's language: the
 * customer person, or the active owner of the customer organization. Nobody is notified when no
 * registered recipient exists (a notification never goes to a guest).
 */
async function notifyInvitationAnswer(
  tx: Prisma.TransactionClient,
  invitation: {
    id: string;
    customerPersonId: string | null;
    customerOrganizationId: string | null;
    customerPerson?: { registeredAt: Date | null } | null;
  },
  event: keyof typeof ANSWER_CONTENT,
  supplierName: string
): Promise<void> {
  let recipientId: string | null = null;
  if (invitation.customerPersonId !== null) {
    if (invitation.customerPerson?.registeredAt) recipientId = invitation.customerPersonId;
  } else if (invitation.customerOrganizationId !== null) {
    recipientId = await findActiveOwnerId(tx, invitation.customerOrganizationId);
  }
  if (recipientId === null) return;

  const language = await recipientLanguage(recipientId, tx);
  const texts =
    event === 'supplier.accepted'
      ? ANSWER_CONTENT['supplier.accepted']
      : ANSWER_CONTENT['supplier.declined'];
  const text = language === 'EN' ? texts.EN : texts.FR;
  await notify(
    {
      recipientId,
      organizationId: invitation.customerOrganizationId ?? undefined,
      sourceEvent: event,
      content: text(supplierName),
      related: { type: 'customer_relationship', id: invitation.id },
    },
    tx
  );
}

/**
 * The invited person accepts an invitation for an organization they manage: the supplier person
 * is replaced by the organization and the status becomes ACTIVE (CM-25, C-08), in one transaction
 * (ASVS v5.0.0-2.3.3). When the organization already has a live relationship with that customer
 * the invitation is deleted instead and `merged` is true (C-07).
 *
 * The invitation is selected by id and supplier person = caller first (404 otherwise,
 * v5.0.0-8.2.2), then the caller's active role in the organization: not a member is 404, below
 * MANAGER is 403 (v5.0.0-8.2.1), then the organization must be ACTIVE. The organization is locked
 * so two accepts for it run one after the other; the swap is one conditional update. The customer
 * is notified `supplier.accepted` after a real acceptance, not after a merge.
 *
 * @param personId - Caller's person id from the session.
 * @param invitationId - Validated invitation id from the path.
 * @param organizationId - Validated organization id from the body.
 * @returns `merged: true`, or `merged: false` with the supplier view of the new relationship.
 * @throws 404 `NOT_FOUND`; 403 `FORBIDDEN`; 409 `ORGANIZATION_NOT_ACTIVE`.
 */
export function acceptSupplierInvitation(
  personId: string,
  invitationId: string,
  organizationId: string
): Promise<{ merged: boolean; relationship?: SupplierRelationshipView }> {
  return runInTransaction(async (tx) => {
    const invitation = await findInvitationLocked(tx, personId, invitationId);
    if (!invitation) throw httpError(404, 'NOT_FOUND', 'Invitation not found');

    const role = await findActiveRole(tx, personId, organizationId);
    if (role === null) throw httpError(404, 'NOT_FOUND', 'Organization not found');
    if (!atLeast(role, 'MANAGER')) {
      logger.warn(
        {
          event: 'permission_refused',
          personId,
          action: 'accept_supplier_invitation',
          subjectType: 'CustomerRelationship',
        },
        'Permission refused'
      );
      throw httpError(403, 'FORBIDDEN', 'Permission denied');
    }
    await assertOrganizationActive(organizationId, tx);
    await lockOrganization(tx, organizationId);

    const exists = await liveRelationshipExists(tx, {
      supplierOrganizationId: organizationId,
      customerPersonId: invitation.customerPersonId,
      customerOrganizationId: invitation.customerOrganizationId,
    });
    if (exists) {
      if (!(await deleteInvitationRow(tx, { id: invitation.id, personId }))) {
        throw httpError(404, 'NOT_FOUND', 'Invitation not found');
      }
      return { merged: true };
    }

    if (!(await acceptInvitationRow(tx, { id: invitation.id, personId, organizationId }))) {
      throw httpError(404, 'NOT_FOUND', 'Invitation not found');
    }
    const row = await findWithParties(tx, invitation.id);
    await notifyInvitationAnswer(
      tx,
      invitation,
      'supplier.accepted',
      row.supplierOrganization?.name ?? ''
    );
    return { merged: false, relationship: projectForSupplier(row) };
  });
}

/**
 * The invited person declines an invitation: the row is deleted (`deleted_at`) and the customer
 * is notified `supplier.declined` (CM-25). Selected by id and supplier person = caller, so another
 * person's invitation answers 404 and is never touched (v5.0.0-8.2.2); one transaction with a
 * row lock and a conditional update (v5.0.0-2.3.3).
 *
 * @param personId - Caller's person id from the session.
 * @param invitationId - Validated invitation id from the path.
 * @throws 404 `NOT_FOUND`.
 */
export function declineSupplierInvitation(personId: string, invitationId: string): Promise<void> {
  return runInTransaction(async (tx) => {
    const invitation = await findInvitationLocked(tx, personId, invitationId);
    if (!invitation) throw httpError(404, 'NOT_FOUND', 'Invitation not found');
    if (!(await deleteInvitationRow(tx, { id: invitation.id, personId }))) {
      throw httpError(404, 'NOT_FOUND', 'Invitation not found');
    }
    const name = (await findPersonName(tx, personId)) ?? '';
    await notifyInvitationAnswer(tx, invitation, 'supplier.declined', name);
  });
}

/** Largest number of items returned in each list of the attachments view. */
const ATTACHMENTS_LIMIT = 100;

/**
 * A newly registered person sees everything attached to their number: their ACTIVE and ENDED
 * relationships as customer, their pending team invitations and the supplier invitations
 * addressed to them. Every query filters on the person id from the session (v5.0.0-8.2.2) and each
 * list is capped at 100. Relationships go through `projectForCustomer`, so `customer_label` and
 * `supplier_notes` are never sent (CM-19, v5.0.0-15.3.1).
 *
 * @param personId - Caller's person id from the session, never from the client.
 */
export async function getAttachments(personId: string): Promise<{
  relationships: CustomerRelationshipView[];
  team_invitations: TeamInvitationView[];
  supplier_invitations: SupplierInvitationView[];
}> {
  const [relationships, team, supplier] = await Promise.all([
    listAttachedRelationships(personId, ATTACHMENTS_LIMIT),
    listMyInvitations(personId, { limit: ATTACHMENTS_LIMIT }),
    listSupplierInvitations(personId, { limit: ATTACHMENTS_LIMIT }),
  ]);
  return {
    relationships: relationships.map(projectForCustomer),
    team_invitations: team.items,
    supplier_invitations: supplier.items,
  };
}

const CONTESTED_CONTENT = {
  FR: 'Un numéro est à corriger',
  EN: 'A number needs to be corrected',
} as const;

/**
 * A customer says "this is not me" about a relationship (CM-24, C-12): a ghost person holding the
 * caller's number as released number becomes the customer, one journal row records it, the
 * caller's `scope_version` is bumped (CM-03) and the supplier's owner and managers are notified
 * `relationship.contested`. Balance, orders and ledger entries stay on the same relationship.
 *
 * The relationship is selected by id and the caller as customer person (404 otherwise, v5.0.0-8.2.2);
 * only ACTIVE and ENDED rows can be contested, a PENDING invitation answers 404 (decline it
 * instead). A second contestation by the same person answers 409 `ALREADY_CONTESTED`, even after
 * the supplier restored the number. Everything runs in one transaction under a row lock
 * (v5.0.0-2.3.3), so a failure leaves no ghost behind.
 *
 * @param personId - Caller's person id from the session.
 * @param relationshipId - Validated relationship id from the path.
 * @param input - Validated body: the gesture id (read by the idempotency guard) and the reason.
 * @throws 404 `NOT_FOUND`; 409 `ALREADY_CONTESTED`.
 */
export function contestRelationship(
  personId: string,
  relationshipId: string,
  input: ContestInput
): Promise<void> {
  return runInTransaction(async (tx) => {
    const row = await findCustomerRelationshipLocked(tx, personId, relationshipId);
    if (!row || row.status === 'PENDING') throw httpError(404, 'NOT_FOUND', 'Supplier not found');

    if (await hasContested(tx, row.id, personId)) {
      logger.warn(
        { event: 'relationship_contest_refused', relationshipId: row.id, personId },
        'Relationship already contested by this person'
      );
      throw httpError(409, 'ALREADY_CONTESTED', 'This relationship was already contested');
    }

    const phoneNumber = await findActivePhoneNumber(tx, personId);
    if (phoneNumber === null) throw new Error('Contesting person holds no active number');

    const ghostId = await insertGhostPerson(tx, phoneNumber);
    if (
      (await repointCustomerPerson(tx, {
        id: row.id,
        fromPersonId: personId,
        toPersonId: ghostId,
      })) !== 'moved'
    ) {
      throw httpError(404, 'NOT_FOUND', 'Supplier not found');
    }
    await insertReassignment(tx, {
      relationshipId: row.id,
      previousPersonId: personId,
      newPersonId: ghostId,
      reassignedById: personId,
      reason: input.reason ?? null,
    });
    await bumpScopeVersion(personId, tx);

    if (row.supplierOrganizationId !== null) {
      for (const recipientId of await listOwnerAndManagerIds(tx, row.supplierOrganizationId)) {
        const language = await recipientLanguage(recipientId, tx);
        await notify(
          {
            recipientId,
            organizationId: row.supplierOrganizationId,
            sourceEvent: 'relationship.contested',
            content: language === 'EN' ? CONTESTED_CONTENT.EN : CONTESTED_CONTENT.FR,
            related: { type: 'customer_relationship', id: row.id },
          },
          tx
        );
      }
    }
    logger.warn(
      { event: 'relationship_contested', relationshipId: row.id, personId },
      'Relationship contested'
    );
  });
}

const CORRECT_NUMBER_CONTEXT = { onServer: false, online: true, daysSinceSync: 0 } as const;

/**
 * An owner, or a manager online, points a customer's relationship to the right number (C-12,
 * CM-24): the account follows the person who holds that number. Balance, orders and ledger entries
 * stay on the same relationship.
 *
 * The rules table decides first (`reassign`, ASVS v5.0.0-8.2.1). One transaction (v5.0.0-2.3.3)
 * then locks the row selected by id and the visibility predicate (404 outside the organization,
 * v5.0.0-8.2.2) and checks, in order: the caller's own record (403 `OWN_RECORD`: below OWNER, the
 * caller is the customer person or manages the customer organization), a person customer (409
 * `NOT_A_PERSON_CUSTOMER`), the target having no live relationship with this supplier (409
 * `RELATIONSHIP_EXISTS`, also when the number is already the customer's) and, when the target
 * contested this relationship, `confirm_same_customer` with a `reason` (409
 * `CONFIRMATION_REQUIRED`). It then repoints the customer, appends one journal row authored by the
 * caller, bumps the scope version of both persons (CM-03) and notifies a registered target
 * `customer.added`. The moved person may contest once (AB-1), so the journal names who moved it.
 *
 * @param actor - Actor loaded from the path; organization, caller and role never come from the body.
 * @param relationshipId - Validated relationship id from the path.
 * @param input - Validated body: gesture id, the right number, optional reason and confirmation.
 * @returns The supplier view of the relationship with its new customer.
 * @throws 403 `FORBIDDEN` or `OWN_RECORD`; 404 `NOT_FOUND`; 409 `NOT_A_PERSON_CUSTOMER`,
 * `RELATIONSHIP_EXISTS`, `CONFIRMATION_REQUIRED` or `ORGANIZATION_NOT_ACTIVE`.
 */
export async function correctCustomerNumber(
  actor: Actor,
  relationshipId: string,
  input: CorrectNumberInput
): Promise<SupplierRelationshipView> {
  if (!abilityFor(actor.role, CORRECT_NUMBER_CONTEXT).can('reassign', 'CustomerRelationship')) {
    refuse(actor, 'permission_refused');
  }

  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const row = await findSupplierRelationshipLocked(tx, actor, relationshipId);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Customer not found');

    const ownPerson = row.customerPersonId === actor.personId;
    const managesCustomer =
      actor.role !== 'OWNER' &&
      row.customerOrganizationId !== null &&
      (await managesOrganization(tx, actor.personId, row.customerOrganizationId));
    if (ownPerson || managesCustomer) refuse(actor, 'own_record_refused');
    const previousPersonId = row.customerPersonId;
    if (previousPersonId === null) {
      throw httpError(409, 'NOT_A_PERSON_CUSTOMER', 'Only a person customer can be corrected');
    }

    const target = await findOrCreateByPhone(input.phone_number, tx);
    const taken = (): never => {
      throw httpError(409, 'RELATIONSHIP_EXISTS', 'This number already has a relationship');
    };
    if (
      await liveRelationshipExists(tx, {
        supplierOrganizationId: actor.organizationId,
        customerPersonId: target.id,
        customerOrganizationId: null,
      })
    ) {
      taken();
    }
    if (
      (await hasContested(tx, row.id, target.id)) &&
      (input.confirm_same_customer !== true || input.reason === undefined)
    ) {
      throw httpError(
        409,
        'CONFIRMATION_REQUIRED',
        'This person contested the relationship: confirm it is the same customer with a reason'
      );
    }

    const moved = await repointCustomerPerson(tx, {
      id: row.id,
      fromPersonId: previousPersonId,
      toPersonId: target.id,
    });
    if (moved === 'gone') throw httpError(404, 'NOT_FOUND', 'Customer not found');
    if (moved === 'taken') taken();
    await insertReassignment(tx, {
      relationshipId: row.id,
      previousPersonId,
      newPersonId: target.id,
      reassignedById: actor.personId,
      reason: input.reason ?? null,
    });
    await bumpScopeVersion(previousPersonId, tx);
    await bumpScopeVersion(target.id, tx);

    const updated = await findWithParties(tx, row.id);
    if (target.registeredAt !== null) {
      const language = await recipientLanguage(target.id, tx);
      const name = updated.supplierOrganization?.name ?? '';
      await notify(
        {
          recipientId: target.id,
          organizationId: actor.organizationId,
          sourceEvent: 'customer.added',
          content: language === 'EN' ? ADDED_CONTENT.EN(name) : ADDED_CONTENT.FR(name),
          related: { type: 'customer_relationship', id: row.id },
        },
        tx
      );
    }
    logger.warn(
      {
        event: 'customer_number_corrected',
        relationshipId: row.id,
        personId: actor.personId,
        previousPersonId,
        newPersonId: target.id,
      },
      'Customer number corrected'
    );
    return projectForSupplier(updated);
  });
}
