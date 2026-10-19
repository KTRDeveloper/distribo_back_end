import type { Prisma } from '@prisma/client';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { registerPhoneReleasedHandler } from '../person/phone-released.js';
import { clearVerificationByNumber, findActiveOwners } from './organization-contact.repository.js';

const CONTACTS_REVIEW_NOTICE = {
  FR: "Un de vos numeros de contact public a change de titulaire. Il n'est plus affiche. Verifiez vos contacts dans les reglages.",
  EN: 'One of your public contact numbers has a new holder. It is no longer shown. Check your contacts in the settings.',
};

/**
 * Sends every verified public contact holding a released number back to pending, then tells the
 * ACTIVE owner of each business touched once (CM-36, C-43). Triggered only by a release, never by
 * a request (ASVS v5.0.0-8.2.1); the owner's own change of number fires nothing. A business with
 * no ACTIVE owner is still downgraded and nobody is notified.
 *
 * Runs in the transaction of the release (PER-014): any failure, the notification included,
 * rolls the release back. The number is neither logged nor written in the notice
 * (ASVS v5.0.0-16.2.5).
 */
export async function handlePhoneReleased(
  event: { phoneNumber: string },
  tx: Prisma.TransactionClient
): Promise<void> {
  const organizationIds = await clearVerificationByNumber(tx, event.phoneNumber);
  if (organizationIds.length === 0) return;

  for (const owner of await findActiveOwners(tx, organizationIds)) {
    const language = await recipientLanguage(owner.personId, tx);
    await notify(
      {
        recipientId: owner.personId,
        organizationId: owner.organizationId,
        sourceEvent: 'organization.contacts_review',
        content: CONTACTS_REVIEW_NOTICE[language],
        related: { type: 'organization', id: owner.organizationId },
      },
      tx
    );
  }
}

registerPhoneReleasedHandler(handlePhoneReleased);
