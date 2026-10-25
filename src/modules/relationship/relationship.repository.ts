import { Prisma } from '@prisma/client';
import type { CustomerRelationship, RelationshipStatus } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { httpError } from '../../lib/http-error.js';
import { newId } from '../../shared/ids.js';
import { normalizeE164 } from '../../shared/phone.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import type { Role } from '../../shared/access/roles.js';
import { visibleRelationsWhere } from './relationship.visibility.js';

/**
 * Creates a counter: an ACTIVE relationship of an organization with no customer, used by
 * anonymous sales (C-06: no customer needs `customer_label`; C-10: a counter's credit limit is 0).
 *
 * Runs on the caller's transaction so the counter commits or rolls back with its organization
 * (ASVS v5.0.0-2.3.3). The limit stays at the database default 0 and no author is recorded: this
 * is creation, not a limit change, so no `credit_limit_changes` row is written.
 *
 * @param tx - Transaction client of the caller.
 * @param input - Supplier organization, counter label and the person who creates it.
 * @returns The stored relationship.
 */
export function createCounter(
  tx: Prisma.TransactionClient,
  input: { supplierOrganizationId: string; label: string; createdById: string }
): Promise<CustomerRelationship> {
  return tx.customerRelationship.create({
    data: {
      id: newId(),
      supplierOrganizationId: input.supplierOrganizationId,
      customerLabel: input.label,
      creditLimit: 0n,
      status: 'ACTIVE',
      createdById: input.createdById,
    },
  });
}

/**
 * Takes a row lock on the organization until the transaction ends, so two concurrent writes that
 * check-then-insert for one organization (the counter label rule has no database index) run one
 * after the other.
 */
export async function lockOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${organizationId}::uuid FOR UPDATE`;
}

/**
 * Tells whether a live counter of the organization already carries this label. Deleted and merged
 * rows do not count. The label is compared exactly, after the trim done by the schema.
 */
export async function counterLabelExists(
  tx: Prisma.TransactionClient,
  organizationId: string,
  label: string
): Promise<boolean> {
  const found = await tx.customerRelationship.findFirst({
    where: {
      supplierOrganizationId: organizationId,
      customerPersonId: null,
      customerOrganizationId: null,
      customerLabel: label,
      deletedAt: null,
      mergedIntoId: null,
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Finds the live relationship of a supplier organization with a customer person or organization.
 *
 * Deleted and merged rows are ignored (C-07). The caller passes exactly one customer id.
 */
function findLive(
  tx: Prisma.TransactionClient,
  input: {
    supplierOrganizationId: string;
    customerPersonId?: string;
    customerOrganizationId?: string;
  }
): Promise<CustomerRelationship | null> {
  return tx.customerRelationship.findFirst({
    where: {
      supplierOrganizationId: input.supplierOrganizationId,
      customerPersonId: input.customerPersonId ?? null,
      customerOrganizationId: input.customerOrganizationId ?? null,
      deletedAt: null,
      mergedIntoId: null,
    },
  });
}

/**
 * Returns the live relationship of a supplier organization with a customer, creating it when
 * absent: ACTIVE, credit limit 0 (database default, so no `credit_limit_changes` row: creation is
 * not a limit change, C-10), balance 0.
 *
 * The insert uses `ON CONFLICT DO NOTHING` against the pair indexes (C-07), so two concurrent
 * calls for one pair never abort the caller's transaction: the loser reads the winner's row and
 * gets `created: false`. Runs on the caller's transaction (ASVS v5.0.0-2.3.3).
 *
 * @param tx - Transaction client of the caller.
 * @param input - Supplier organization, exactly one customer (person or organization) and the
 * registered person who creates the relationship.
 * @returns The live relationship and whether this call created it.
 */
export async function ensureCustomerRelationship(
  tx: Prisma.TransactionClient,
  input: {
    supplierOrganizationId: string;
    customerPersonId?: string;
    customerOrganizationId?: string;
    createdById: string;
    customerLabel?: string;
    deliveryAddress?: string;
  }
): Promise<{ relationship: CustomerRelationship; created: boolean }> {
  const existing = await findLive(tx, input);
  if (existing) return { relationship: existing, created: false };

  const inserted = await tx.$executeRaw`
    INSERT INTO "customer_relationships" (
      "id", "supplier_organization_id", "customer_person_id", "customer_organization_id",
      "customer_label", "delivery_address", "credit_limit", "status", "created_by_id"
    )
    VALUES (
      ${newId()}::uuid, ${input.supplierOrganizationId}::uuid,
      ${input.customerPersonId ?? null}::uuid, ${input.customerOrganizationId ?? null}::uuid,
      ${input.customerLabel ?? null}, ${input.deliveryAddress ?? null}, 0,
      'ACTIVE'::"RelationshipStatus", ${input.createdById}::uuid
    )
    ON CONFLICT DO NOTHING
  `;

  const relationship = await findLive(tx, input);
  if (!relationship) {
    throw new Error('Relationship neither created nor found');
  }
  return { relationship, created: inserted === 1 };
}

/**
 * Reloads a relationship with its customer person and supplier organization, the parties that
 * `projectForSupplier` and the customer notification need.
 */
export function findWithParties(tx: Prisma.TransactionClient, id: string) {
  return tx.customerRelationship.findUniqueOrThrow({
    where: { id },
    include: { customerPerson: true, supplierOrganization: true },
  });
}

/**
 * Lists the organization's relationships as supplier, newest first (created_at descending then
 * id), keyset-paged. The query starts from the visibility predicate for the organization
 * (v5.0.0-8.2.2) and narrows it to the rows where the organization is the supplier; deleted and
 * merged rows never match. A counter is a relationship with no customer person or organization.
 *
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param query - Page size, opaque cursor and optional status and counter filters.
 * @returns Rows (at most limit) with the customer parties loaded, and the next cursor or null.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listSupplierRelationships(
  viewer: { personId: string; organizationId: string },
  query: { limit: number; cursor?: string; status?: RelationshipStatus; counter?: boolean }
) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const and: Prisma.CustomerRelationshipWhereInput[] = [
    visibleRelationsWhere({
      personId: viewer.personId,
      organizationIds: [viewer.organizationId],
    }),
    { supplierOrganizationId: viewer.organizationId },
  ];
  if (query.status) and.push({ status: query.status });
  if (query.counter === true) and.push({ customerPersonId: null, customerOrganizationId: null });
  if (query.counter === false) {
    and.push({
      OR: [{ customerPersonId: { not: null } }, { customerOrganizationId: { not: null } }],
    });
  }
  if (cursor) {
    and.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: cursor.id } },
      ],
    });
  }

  const found = await prisma.customerRelationship.findMany({
    where: { AND: and },
    include: { customerPerson: true, customerOrganization: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const rows = found.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

/**
 * Lists the relationships where the person is the customer, newest first (created_at descending
 * then id), keyset-paged: ACTIVE, ENDED and the PENDING invitations the person sent. The query
 * starts from the visibility predicate for the person (v5.0.0-8.2.2) and narrows it to the rows
 * where the person is the customer person, so rows where the person is only the supplier person
 * never match; deleted and merged rows never match either.
 *
 * @param personId - Caller's person id from the session, never from the client.
 * @param query - Page size, opaque cursor and optional status filter.
 * @returns Rows (at most limit) with the supplier parties loaded, and the next cursor or null.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export function listCustomerRelationships(
  personId: string,
  query: { limit: number; cursor?: string; status?: RelationshipStatus }
) {
  return pageOfSuppliers(
    [visibleRelationsWhere({ personId, organizationIds: [] }), { customerPersonId: personId }],
    query
  );
}

/**
 * Lists what is attached to the person as customer: the ACTIVE and ENDED relationships, newest
 * first, at most `limit` rows. The query starts from the visibility predicate for the person and
 * narrows it to the rows where the person is the customer person (v5.0.0-8.2.2); PENDING
 * invitations the person sent, deleted and merged rows never match.
 *
 * @param personId - Caller's person id from the session, never from the client.
 * @param limit - Maximum number of rows.
 * @returns Rows with the supplier parties loaded.
 */
export async function listAttachedRelationships(personId: string, limit: number) {
  return (
    await pageOfSuppliers(
      [
        visibleRelationsWhere({ personId, organizationIds: [] }),
        { customerPersonId: personId, status: { in: ['ACTIVE', 'ENDED'] } },
      ],
      { limit }
    )
  ).rows;
}

/**
 * Lists the relationships where the organization is the customer organization, newest first,
 * keyset-paged. The query starts from the visibility predicate for the organization
 * (v5.0.0-8.2.2) and narrows it to the rows whose customer organization is that organization;
 * deleted and merged rows never match.
 *
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param query - Page size, opaque cursor and optional status filter.
 * @returns Rows (at most limit) with the supplier parties loaded, and the next cursor or null.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export function listOrganizationSuppliers(
  viewer: { personId: string; organizationId: string },
  query: { limit: number; cursor?: string; status?: RelationshipStatus }
) {
  return pageOfSuppliers(
    [
      visibleRelationsWhere({
        personId: viewer.personId,
        organizationIds: [viewer.organizationId],
      }),
      { customerOrganizationId: viewer.organizationId },
    ],
    query
  );
}

/** Pages the customer-side rows matching `scope`: status filter, keyset cursor, supplier parties. */
async function pageOfSuppliers(
  scope: Prisma.CustomerRelationshipWhereInput[],
  query: { limit: number; cursor?: string; status?: RelationshipStatus }
) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const and = [...scope];
  if (query.status) and.push({ status: query.status });
  if (cursor) {
    and.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: cursor.id } },
      ],
    });
  }

  const found = await prisma.customerRelationship.findMany({
    where: { AND: and },
    include: { supplierPerson: true, supplierOrganization: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const rows = found.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

/**
 * Finds one relationship of the organization as supplier by id, through the visibility predicate
 * (v5.0.0-8.2.2): id and visibility are matched in the same query, so another business's row is
 * indistinguishable from an absent one. Deleted and merged rows never match.
 *
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param id - Relationship id from the path.
 * @returns The row with the customer parties loaded, or null.
 */
export function findSupplierRelationship(
  viewer: { personId: string; organizationId: string },
  id: string
) {
  return prisma.customerRelationship.findFirst({
    where: {
      AND: [
        visibleRelationsWhere({
          personId: viewer.personId,
          organizationIds: [viewer.organizationId],
        }),
        { supplierOrganizationId: viewer.organizationId },
        { id },
      ],
    },
    include: { customerPerson: true, customerOrganization: true },
  });
}

/**
 * Updates the supplier-side fields of one relationship of the organization as supplier.
 *
 * The lookup and the update run in one transaction, and the lookup goes through the visibility
 * predicate (v5.0.0-8.2.2), so another business's row, a deleted or a merged one answers null
 * exactly like an absent id. Only the keys present in `data` are written.
 *
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param id - Relationship id from the path.
 * @param data - Validated fields to write (`undefined` keys are left untouched).
 * @returns The updated row with the customer parties loaded, or null when not visible.
 */
export function updateSupplierFields(
  viewer: { personId: string; organizationId: string },
  id: string,
  data: {
    customerLabel?: string;
    deliveryAddress?: string | null;
    supplierNotes?: string | null;
  }
) {
  return prisma.$transaction(async (tx) => {
    const found = await tx.customerRelationship.findFirst({
      where: {
        AND: [
          visibleRelationsWhere({
            personId: viewer.personId,
            organizationIds: [viewer.organizationId],
          }),
          { supplierOrganizationId: viewer.organizationId },
          { id },
        ],
      },
      select: { id: true },
    });
    if (!found) return null;
    return tx.customerRelationship.update({
      where: { id: found.id },
      data,
      include: { customerPerson: true, customerOrganization: true },
    });
  });
}

/**
 * Reads one relationship of the organization as supplier and holds a row lock on it until the
 * transaction ends, so a concurrent limit change, end or merge waits and the checks of the caller
 * (status, customer) stay true until it writes.
 *
 * The scoped lookup runs first, through the visibility predicate (v5.0.0-8.2.2): another
 * business's row, a deleted or a merged one answers null like an absent id, and is never locked.
 *
 * @param tx - Transaction client of the caller.
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param id - Relationship id from the path.
 * @returns The locked row with the customer parties loaded, or null.
 */
export async function findSupplierRelationshipLocked(
  tx: Prisma.TransactionClient,
  viewer: { personId: string; organizationId: string },
  id: string
) {
  const scope: Prisma.CustomerRelationshipWhereInput = {
    AND: [
      visibleRelationsWhere({
        personId: viewer.personId,
        organizationIds: [viewer.organizationId],
      }),
      { supplierOrganizationId: viewer.organizationId },
      { id },
    ],
  };
  const found = await tx.customerRelationship.findFirst({ where: scope, select: { id: true } });
  if (!found) return null;
  await tx.$queryRaw`SELECT "id" FROM "customer_relationships" WHERE "id" = ${found.id}::uuid FOR UPDATE`;
  return tx.customerRelationship.findFirst({
    where: scope,
    include: { customerPerson: true, customerOrganization: true },
  });
}

/** Tells whether the person is an ACTIVE MANAGER or OWNER of the organization. */
export async function managesOrganization(
  tx: Prisma.TransactionClient,
  personId: string,
  organizationId: string
): Promise<boolean> {
  const found = await tx.collaboration.findFirst({
    where: {
      personId,
      organizationId,
      role: { in: ['MANAGER', 'OWNER'] },
      status: 'ACTIVE',
      deletedAt: null,
    },
    select: { id: true },
  });
  return found !== null;
}

/** Reads the display name of a person, for a notification text. */
export async function findPersonName(
  tx: Prisma.TransactionClient,
  personId: string
): Promise<string | null> {
  const person = await tx.person.findUnique({
    where: { id: personId },
    select: { fullName: true },
  });
  return person?.fullName ?? null;
}

/**
 * Writes a new credit limit and its author on a relationship the caller has locked. The database
 * stamps `credit_limit_set_at` and writes the journal row in the same statement (REL-004).
 *
 * The REL-004 trigger refuses a limit change whose author is unchanged. When the caller is
 * already the recorded author, `clearAuthorFirst` blanks author and time (both together, so the
 * pair rule holds) in a statement that does not touch the limit; the row lock and the caller's
 * transaction make the two statements invisible to anyone else.
 *
 * @param tx - Transaction client of the caller.
 * @param id - Relationship id, already checked and locked.
 * @param input - New limit (null: no ceiling), author, and whether the author must be blanked.
 */
export async function writeCreditLimit(
  tx: Prisma.TransactionClient,
  id: string,
  input: { creditLimit: bigint | null; setById: string; clearAuthorFirst: boolean }
): Promise<void> {
  if (input.clearAuthorFirst) {
    await tx.customerRelationship.update({
      where: { id },
      data: { creditLimitSetById: null, creditLimitSetAt: null },
    });
  }
  await tx.customerRelationship.update({
    where: { id },
    data: { creditLimit: input.creditLimit, creditLimitSetById: input.setById },
  });
}

/**
 * Lists the credit limit journal of one relationship of the organization as supplier, newest
 * first (`set_at` descending then id), keyset-paged.
 *
 * The relationship is loaded first, through the visibility predicate (v5.0.0-8.2.2): another
 * business's row, a deleted or a merged one answers null like an absent id, and its journal is
 * never read. The cursor reuses the shared one, carrying `set_at` in its `createdAt` field.
 *
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param id - Relationship id from the path.
 * @param query - Page size and opaque cursor.
 * @returns Journal rows (at most limit) and the next cursor or null; null when not visible.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listCreditLimitChangeRows(
  viewer: { personId: string; organizationId: string },
  id: string,
  query: { limit: number; cursor?: string }
) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const relationship = await findSupplierRelationship(viewer, id);
  if (!relationship) return null;

  const and: Prisma.CreditLimitChangeWhereInput[] = [{ customerRelationshipId: relationship.id }];
  if (cursor) {
    and.push({
      OR: [{ setAt: { lt: cursor.createdAt } }, { setAt: cursor.createdAt, id: { gt: cursor.id } }],
    });
  }
  const found = await prisma.creditLimitChange.findMany({
    where: { AND: and },
    orderBy: [{ setAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const rows = found.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.setAt, id: last.id })
        : null,
  };
}

/**
 * Moves a locked relationship from one status to another in one conditional update, so the
 * transition only happens if the row is still in the expected state (ASVS v5.0.0-2.3.1). The
 * status and `ended_by_party` are written together: filled in exactly when ENDED (C-09).
 *
 * @param tx - Transaction client of the caller.
 * @param id - Relationship id, already scoped and locked.
 * @param transition - Expected current state and the state to write.
 * @returns True when one row was updated, false when the row was no longer in the expected state.
 */
export async function transitionRelationship(
  tx: Prisma.TransactionClient,
  id: string,
  transition: {
    from: { status: 'ACTIVE' | 'ENDED'; endedByParty: 'SUPPLIER' | 'CUSTOMER' | null };
    to: { status: 'ACTIVE' | 'ENDED'; endedByParty: 'SUPPLIER' | 'CUSTOMER' | null };
  }
): Promise<boolean> {
  const { count } = await tx.customerRelationship.updateMany({
    where: { id, status: transition.from.status, endedByParty: transition.from.endedByParty },
    data: { status: transition.to.status, endedByParty: transition.to.endedByParty },
  });
  return count === 1;
}

/** Where clause of one relationship of the person as customer person, through the visibility predicate. */
function customerScope(personId: string, id: string): Prisma.CustomerRelationshipWhereInput {
  return {
    AND: [
      visibleRelationsWhere({ personId, organizationIds: [] }),
      { customerPersonId: personId },
      { id },
    ],
  };
}

/**
 * Updates `supplier_label` of one relationship where the person is the customer person.
 *
 * The row is matched by id, visibility and customer person in one conditional update
 * (v5.0.0-8.2.2), so another person's row, a deleted or a merged one answers null exactly like
 * an absent id. Only `supplier_label` is written (v5.0.0-15.3.3).
 *
 * @param personId - Caller's person id from the session, never from the client.
 * @param id - Relationship id from the path.
 * @param supplierLabel - Validated label.
 * @returns The updated row with the supplier parties loaded, or null when not visible.
 */
export function updateSupplierLabel(personId: string, id: string, supplierLabel: string) {
  return writeSupplierLabel(customerScope(personId, id), supplierLabel);
}

/**
 * Updates `supplier_label` of one relationship where the organization is the customer
 * organization. The row is matched by id, visibility and customer organization in one
 * transaction (v5.0.0-8.2.2): another business's row, a relationship where the organization is
 * only the supplier, a deleted or a merged one answers null like an absent id. Only
 * `supplier_label` is written (v5.0.0-15.3.3).
 *
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param id - Relationship id from the path.
 * @param supplierLabel - Validated label.
 * @returns The updated row with the supplier parties loaded, or null when not visible.
 */
export function updateOrganizationSupplierLabel(
  viewer: { personId: string; organizationId: string },
  id: string,
  supplierLabel: string
) {
  return writeSupplierLabel(
    {
      AND: [
        visibleRelationsWhere({
          personId: viewer.personId,
          organizationIds: [viewer.organizationId],
        }),
        { customerOrganizationId: viewer.organizationId },
        { id },
      ],
    },
    supplierLabel
  );
}

/** Finds the one row matching `where`, then writes only `supplier_label` on it. */
function writeSupplierLabel(where: Prisma.CustomerRelationshipWhereInput, supplierLabel: string) {
  return prisma.$transaction(async (tx) => {
    const found = await tx.customerRelationship.findFirst({ where, select: { id: true } });
    if (!found) return null;
    return tx.customerRelationship.update({
      where: { id: found.id },
      data: { supplierLabel },
      include: { supplierPerson: true, supplierOrganization: true },
    });
  });
}

/**
 * Reads one relationship where the organization is the customer organization and holds a row lock
 * on it until the transaction ends, so a concurrent end, reopen or merge waits. Selected by id,
 * visibility and customer organization together (v5.0.0-8.2.2): another business's row, one where
 * the organization is only the supplier, a deleted or a merged one answers null and is never locked.
 *
 * @param tx - Transaction client of the caller.
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param id - Relationship id from the path.
 * @returns The locked row with the supplier parties loaded, or null.
 */
export async function findOrganizationSupplierLocked(
  tx: Prisma.TransactionClient,
  viewer: { personId: string; organizationId: string },
  id: string
) {
  const scope: Prisma.CustomerRelationshipWhereInput = {
    AND: [
      visibleRelationsWhere({
        personId: viewer.personId,
        organizationIds: [viewer.organizationId],
      }),
      { customerOrganizationId: viewer.organizationId },
      { id },
    ],
  };
  const found = await tx.customerRelationship.findFirst({ where: scope, select: { id: true } });
  if (!found) return null;
  await tx.$queryRaw`SELECT "id" FROM "customer_relationships" WHERE "id" = ${found.id}::uuid FOR UPDATE`;
  return tx.customerRelationship.findFirst({
    where: scope,
    include: { supplierPerson: true, supplierOrganization: true },
  });
}

/**
 * Reads one relationship where the person is the customer person and holds a row lock on it
 * until the transaction ends, so a concurrent end, reopen or merge waits. The scoped lookup
 * runs first (v5.0.0-8.2.2): another person's row answers null and is never locked.
 *
 * @param tx - Transaction client of the caller.
 * @param personId - Caller's person id from the session, never from the client.
 * @param id - Relationship id from the path.
 * @returns The locked row with the supplier parties loaded, or null.
 */
export async function findCustomerRelationshipLocked(
  tx: Prisma.TransactionClient,
  personId: string,
  id: string
) {
  const where = customerScope(personId, id);
  const found = await tx.customerRelationship.findFirst({ where, select: { id: true } });
  if (!found) return null;
  await tx.$queryRaw`SELECT "id" FROM "customer_relationships" WHERE "id" = ${found.id}::uuid FOR UPDATE`;
  return tx.customerRelationship.findFirst({
    where,
    include: { supplierPerson: true, supplierOrganization: true },
  });
}

/** Reloads a relationship with its supplier parties, the ones `projectForCustomer` needs. */
export function findWithSupplier(tx: Prisma.TransactionClient, id: string) {
  return tx.customerRelationship.findUniqueOrThrow({
    where: { id },
    include: { supplierPerson: true, supplierOrganization: true },
  });
}

/**
 * Inserts a PENDING invitation: the supplier is a person, the customer a person or an
 * organization (C-06, C-08), credit limit 0 (C-10, database default, so no journal row). The
 * insert uses `ON CONFLICT DO NOTHING` against the pair indexes (C-07), so a concurrent duplicate
 * never aborts the caller's transaction.
 *
 * @param tx - Transaction client of the caller.
 * @param input - Supplier person, exactly one customer, label and the registered creator.
 * @returns The new row's id, or null when a live relationship already exists for the pair.
 */
export async function insertInvitation(
  tx: Prisma.TransactionClient,
  input: {
    supplierPersonId: string;
    customerPersonId?: string;
    customerOrganizationId?: string;
    supplierLabel: string;
    createdById: string;
  }
): Promise<string | null> {
  const id = newId();
  const inserted = await tx.$executeRaw`
    INSERT INTO "customer_relationships" (
      "id", "supplier_person_id", "customer_person_id", "customer_organization_id",
      "supplier_label", "credit_limit", "status", "created_by_id"
    )
    VALUES (
      ${id}::uuid, ${input.supplierPersonId}::uuid,
      ${input.customerPersonId ?? null}::uuid, ${input.customerOrganizationId ?? null}::uuid,
      ${input.supplierLabel}, 0, 'PENDING'::"RelationshipStatus", ${input.createdById}::uuid
    )
    ON CONFLICT DO NOTHING
  `;
  return inserted === 1 ? id : null;
}

/** Where clause of one PENDING invitation addressed to the person as supplier person. */
function invitationScope(personId: string, id?: string): Prisma.CustomerRelationshipWhereInput {
  return {
    AND: [
      visibleRelationsWhere({ personId, organizationIds: [] }),
      { supplierPersonId: personId, status: 'PENDING' },
      ...(id === undefined ? [] : [{ id }]),
    ],
  };
}

/**
 * Lists the PENDING invitations addressed to the person as supplier person, newest first
 * (created_at descending then id), keyset-paged. Selected through the visibility predicate and the
 * supplier person (v5.0.0-8.2.2): another person's invitation, a deleted or a merged one never
 * matches.
 *
 * @param personId - Caller's person id from the session, never from the client.
 * @param query - Page size and opaque cursor.
 * @returns Rows (at most limit) with the customer parties loaded, and the next cursor or null.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listInvitationRows(
  personId: string,
  query: { limit: number; cursor?: string }
) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const and: Prisma.CustomerRelationshipWhereInput[] = [invitationScope(personId)];
  if (cursor) {
    and.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: cursor.id } },
      ],
    });
  }

  const found = await prisma.customerRelationship.findMany({
    where: { AND: and },
    include: { customerPerson: true, customerOrganization: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const rows = found.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

/**
 * Reads one PENDING invitation addressed to the person and holds a row lock on it until the
 * transaction ends, so a concurrent accept or decline waits and then finds nothing. Selected by id,
 * visibility, status and supplier person together (v5.0.0-8.2.2): another person's invitation, an
 * answered, a deleted or a merged one answers null and is never locked.
 *
 * @param tx - Transaction client of the caller.
 * @param personId - Caller's person id from the session, never from the client.
 * @param id - Invitation id from the path.
 * @returns The locked row with the customer parties loaded, or null.
 */
export async function findInvitationLocked(
  tx: Prisma.TransactionClient,
  personId: string,
  id: string
) {
  const where = invitationScope(personId, id);
  const found = await tx.customerRelationship.findFirst({ where, select: { id: true } });
  if (!found) return null;
  await tx.$queryRaw`SELECT "id" FROM "customer_relationships" WHERE "id" = ${found.id}::uuid FOR UPDATE`;
  return tx.customerRelationship.findFirst({
    where,
    include: { customerPerson: true, customerOrganization: true },
  });
}

/** Reads the role of the person in the organization, or null when not an ACTIVE member. */
export async function findActiveRole(
  tx: Prisma.TransactionClient,
  personId: string,
  organizationId: string
): Promise<Role | null> {
  const found = await tx.collaboration.findFirst({
    where: { personId, organizationId, status: 'ACTIVE', deletedAt: null },
    select: { role: true },
  });
  return found?.role ?? null;
}

/** Tells whether the organization has a live relationship as supplier with this customer. */
export async function liveRelationshipExists(
  tx: Prisma.TransactionClient,
  input: {
    supplierOrganizationId: string;
    customerPersonId: string | null;
    customerOrganizationId: string | null;
  }
): Promise<boolean> {
  const found = await tx.customerRelationship.findFirst({
    where: {
      supplierOrganizationId: input.supplierOrganizationId,
      customerPersonId: input.customerPersonId,
      customerOrganizationId: input.customerOrganizationId,
      deletedAt: null,
      mergedIntoId: null,
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Swaps the supplier of a locked invitation: the supplier person becomes empty, the organization
 * becomes the supplier and the status ACTIVE, all in one conditional update (ASVS v5.0.0-2.3.3), so
 * the row changes only if it is still PENDING for that person (CM-25, C-08).
 *
 * @returns True when one row was updated, false when the invitation was no longer pending.
 */
export async function acceptInvitationRow(
  tx: Prisma.TransactionClient,
  input: { id: string; personId: string; organizationId: string }
): Promise<boolean> {
  const { count } = await tx.customerRelationship.updateMany({
    where: {
      id: input.id,
      supplierPersonId: input.personId,
      status: 'PENDING',
      deletedAt: null,
      mergedIntoId: null,
    },
    data: {
      supplierPersonId: null,
      supplierOrganizationId: input.organizationId,
      status: 'ACTIVE',
    },
  });
  return count === 1;
}

/**
 * Deletes a locked invitation (`deleted_at`) in one conditional update: refused, declined or merged
 * into an existing relationship (CM-25). The row stays PENDING with its supplier person, so C-08
 * holds. Only the invitation addressed to the person is touched.
 *
 * @returns True when one row was updated, false when the invitation was no longer pending.
 */
export async function deleteInvitationRow(
  tx: Prisma.TransactionClient,
  input: { id: string; personId: string }
): Promise<boolean> {
  const { count } = await tx.customerRelationship.updateMany({
    where: {
      id: input.id,
      supplierPersonId: input.personId,
      status: 'PENDING',
      deletedAt: null,
      mergedIntoId: null,
    },
    data: { deletedAt: new Date() },
  });
  return count === 1;
}

/**
 * Sets `contested_at` on a locked relationship in one conditional update, so the mark is written
 * only if it is still empty (ASVS v5.0.0-2.3.3). Nothing else on the row changes.
 *
 * @returns True when the mark was set, false when it was already set.
 */
export async function markContested(
  tx: Prisma.TransactionClient,
  id: string,
  at: Date
): Promise<boolean> {
  const { count } = await tx.customerRelationship.updateMany({
    where: { id, contestedAt: null },
    data: { contestedAt: at },
  });
  return count === 1;
}

/**
 * Points a relationship at another customer person in one conditional update, so the row changes
 * only if the previous person is still the customer (ASVS v5.0.0-2.3.3).
 *
 * @returns True when one row was updated.
 */
export async function reassignCustomerPerson(
  tx: Prisma.TransactionClient,
  input: { id: string; fromPersonId: string; toPersonId: string }
): Promise<boolean> {
  const { count } = await tx.customerRelationship.updateMany({
    where: { id: input.id, customerPersonId: input.fromPersonId },
    data: { customerPersonId: input.toPersonId },
  });
  return count === 1;
}

/** Appends one row to the reassignment journal; the journal is never updated afterwards (C-12). */
export function insertReassignment(
  tx: Prisma.TransactionClient,
  input: {
    relationshipId: string;
    previousPersonId: string;
    newPersonId: string;
    reassignedById: string;
    reason: string | null;
  }
) {
  return tx.customerRelationshipReassignment.create({
    data: {
      id: newId(),
      customerRelationshipId: input.relationshipId,
      previousPersonId: input.previousPersonId,
      newPersonId: input.newPersonId,
      reassignedById: input.reassignedById,
      reason: input.reason,
    },
    select: { id: true },
  });
}

/** Lists the registered people holding an ACTIVE OWNER or MANAGER role in the organization. */
export async function listOwnerAndManagerIds(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<string[]> {
  const found = await tx.collaboration.findMany({
    where: {
      organizationId,
      role: { in: ['OWNER', 'MANAGER'] },
      status: 'ACTIVE',
      deletedAt: null,
      person: { registeredAt: { not: null } },
    },
    select: { personId: true },
    orderBy: { personId: 'asc' },
  });
  return found.map((collaboration) => collaboration.personId);
}

/**
 * Points a locked relationship at another customer person.
 *
 * @returns `moved` when one row changed, `gone` when the previous person is no longer the
 * customer, `taken` when the pair index (C-07) refused the target because a concurrent write made
 * it a live customer of the same supplier. The caller's transaction is aborted after `taken`.
 */
export async function repointCustomerPerson(
  tx: Prisma.TransactionClient,
  input: { id: string; fromPersonId: string; toPersonId: string }
): Promise<'moved' | 'gone' | 'taken'> {
  try {
    return (await reassignCustomerPerson(tx, input)) ? 'moved' : 'gone';
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return 'taken';
    }
    throw error;
  }
}

/** Longest chain of merges `resolveMergedRelation` follows before it gives up. */
const MAX_MERGE_HOPS = 5;

/**
 * Folds a customer record created twice offline into the first one: the duplicate gets
 * `deleted_at`, `merged_into_id` = the kept id and an empty `customer_phone_number` (C-06, C-07,
 * C-35). The kept row keeps all its settings; no ledger entry or order is rewritten.
 *
 * Both rows are locked, in id order so two opposite merges cannot deadlock, before anything is
 * read or written (ASVS v5.0.0-2.3.4); the merge runs on the caller's transaction, so it commits
 * or rolls back as a whole (v5.0.0-2.3.3). A repeat on a duplicate already merged into the same
 * kept row changes nothing.
 *
 * The rows must be live, share one supplier organization and name the same person: the same
 * customer person, or a duplicate with no person whose typed number normalizes to the kept row
 * person's number. A counter, an organization customer, an absent or deleted row, the same row
 * twice or two different people are refused: merging must never join two identities.
 *
 * @param tx - Transaction client of the caller.
 * @param duplicateId - The record to fold away.
 * @param keptId - The record that stays live.
 * @throws 409 `CANNOT_MERGE` when the pair cannot be merged.
 */
export async function mergeDuplicateRelation(
  tx: Prisma.TransactionClient,
  duplicateId: string,
  keptId: string
): Promise<void> {
  if (duplicateId === keptId) throw cannotMerge();

  await tx.$queryRaw`
    SELECT "id" FROM "customer_relationships"
    WHERE "id" IN (${duplicateId}::uuid, ${keptId}::uuid)
    ORDER BY "id" FOR UPDATE`;
  const [duplicate, kept] = await Promise.all([
    tx.customerRelationship.findUnique({ where: { id: duplicateId } }),
    tx.customerRelationship.findUnique({
      where: { id: keptId },
      include: { customerPerson: { select: { phoneNumber: true } } },
    }),
  ]);
  if (!duplicate || !kept) throw cannotMerge();
  if (duplicate.mergedIntoId === keptId) return;
  if (duplicate.deletedAt || duplicate.mergedIntoId) throw cannotMerge();
  if (kept.deletedAt || kept.mergedIntoId) throw cannotMerge();
  if (duplicate.supplierOrganizationId === null) throw cannotMerge();
  if (duplicate.supplierOrganizationId !== kept.supplierOrganizationId) throw cannotMerge();

  if (!sameCustomerPerson(duplicate, kept)) throw cannotMerge();

  await tx.customerRelationship.update({
    where: { id: duplicateId },
    data: { deletedAt: new Date(), mergedIntoId: keptId, customerPhoneNumber: null },
  });
}

/** Tells whether both rows name one customer person (never a counter or an organization). */
function sameCustomerPerson(
  duplicate: CustomerRelationship,
  kept: CustomerRelationship & { customerPerson: { phoneNumber: string | null } | null }
): boolean {
  if (kept.customerPersonId === null) return false;
  if (duplicate.customerPersonId !== null) {
    return duplicate.customerPersonId === kept.customerPersonId;
  }
  if (duplicate.customerOrganizationId !== null || duplicate.customerPhoneNumber === null) {
    return false;
  }
  const typed = normalizeE164(duplicate.customerPhoneNumber);
  return typed !== null && typed === kept.customerPerson?.phoneNumber;
}

function cannotMerge() {
  return httpError(409, 'CANNOT_MERGE', 'These relationships cannot be merged');
}

/**
 * Follows `merged_into_id` from a relationship id to the live one, at most 5 hops. An id that is
 * not merged, or that matches no row, returns itself.
 *
 * @param id - A relationship id, possibly of a merged duplicate.
 * @param tx - Transaction client of the caller; the shared client when absent.
 * @returns The id of the live relationship.
 * @throws Error when the chain is longer than 5 hops: a loop or corrupt data must not spin.
 */
export async function resolveMergedRelation(
  id: string,
  tx?: Prisma.TransactionClient
): Promise<string> {
  const client = tx ?? prisma;
  let current = id;
  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop += 1) {
    const row = await client.customerRelationship.findUnique({
      where: { id: current },
      select: { mergedIntoId: true },
    });
    if (!row?.mergedIntoId) return current;
    current = row.mergedIntoId;
  }
  throw new Error('Merge chain too long');
}

/**
 * Adds `delta` to a relationship's cached balance with one atomic SQL increment inside the
 * caller's transaction, so simultaneous operations never lose an update (C-37; ASVS
 * v5.0.0-2.3.3, v5.0.0-2.3.4). Never read then write. The row lock the update takes also orders
 * concurrent writers. Callers update this balance first, then the collaborator's amount held.
 *
 * @param tx - The caller's transaction; a rollback undoes the increment.
 * @param relationshipId - A live relationship (resolve a merged id first).
 * @param delta - Signed amount in XAF to add.
 * @throws 404 NOT_FOUND when the relationship does not exist or is marked deleted.
 */
export async function addToBalance(
  tx: Prisma.TransactionClient,
  relationshipId: string,
  delta: bigint
): Promise<void> {
  const updated = await tx.$executeRaw`
    UPDATE customer_relationships SET balance = balance + ${delta}
    WHERE id = ${relationshipId}::uuid AND deleted_at IS NULL
  `;
  if (updated === 0) throw httpError(404, 'NOT_FOUND', 'Not found');
}
