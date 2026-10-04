import type { Prisma } from '@prisma/client';
import type { Actor } from '../../types/express.js';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { findActiveOwnerId, runInTransaction } from '../organization/organization.repository.js';
import { findOrCreateByPhone } from '../person/person.repository.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { atLeast } from '../../shared/access/roles.js';
import { subject } from '@casl/ability';
import { abilityFor } from '../../shared/access/ability.js';
import type {
  AddCounterInput,
  AddCustomerInput,
  EditCustomerInput,
  EditSupplierInput,
  ListCustomersQuery,
  ListSuppliersQuery,
  SetCreditLimitInput,
} from './relationship.schemas.js';
import {
  counterLabelExists,
  createCounter,
  ensureCustomerRelationship,
  findPersonName,
  findCustomerRelationshipLocked,
  findOrganizationSupplierLocked,
  findSupplierRelationship,
  findSupplierRelationshipLocked,
  findWithParties,
  findWithSupplier,
  listCreditLimitChangeRows,
  listCustomerRelationships,
  listOrganizationSuppliers,
  listSupplierRelationships,
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
  type CustomerRelationshipView,
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
