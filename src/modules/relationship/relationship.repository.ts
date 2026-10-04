import type { CustomerRelationship, Prisma, RelationshipStatus } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { newId } from '../../shared/ids.js';
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
