import type { Actor } from '../../types/express.js';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { runInTransaction } from '../organization/organization.repository.js';
import { findOrCreateByPhone } from '../person/person.repository.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { atLeast } from '../../shared/access/roles.js';
import type { AddCustomerInput, ListCustomersQuery } from './relationship.schemas.js';
import {
  ensureCustomerRelationship,
  findWithParties,
  listSupplierRelationships,
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
  if (!atLeast(actor.role, 'SELLER')) {
    logger.warn(
      {
        event: 'permission_refused',
        personId: actor.personId,
        action: 'list',
        subjectType: 'CustomerRelationship',
      },
      'Permission refused'
    );
    throw httpError(403, 'FORBIDDEN', 'Permission denied');
  }

  const { rows, nextCursor } = await listSupplierRelationships(actor, query);
  return { items: rows.map(projectForSupplier), next_cursor: nextCursor };
}
