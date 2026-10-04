import type { Actor } from '../../types/express.js';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { runInTransaction } from '../organization/organization.repository.js';
import { findOrCreateByPhone } from '../person/person.repository.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { atLeast } from '../../shared/access/roles.js';
import { abilityFor } from '../../shared/access/ability.js';
import type {
  AddCustomerInput,
  EditCustomerInput,
  ListCustomersQuery,
} from './relationship.schemas.js';
import {
  ensureCustomerRelationship,
  findSupplierRelationship,
  findWithParties,
  listSupplierRelationships,
  updateSupplierFields,
} from './relationship.repository.js';
import { projectForSupplier, type SupplierRelationshipView } from './relationship.visibility.js';

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
