import type { Actor } from '../../types/express.js';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { runInTransaction } from '../organization/organization.repository.js';
import { findOrCreateByPhone } from '../person/person.repository.js';
import type { AddCustomerInput } from './relationship.schemas.js';
import { ensureCustomerRelationship, findWithParties } from './relationship.repository.js';
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
