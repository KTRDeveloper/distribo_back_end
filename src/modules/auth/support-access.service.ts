import type { Prisma } from '@prisma/client';
import { firePhoneReleased } from '../person/phone-released.js';
import { findRegisteredActiveNumber, releaseRegisteredHolder } from './auth.repository.js';

/**
 * Releases the active number of a registered person the way a recycled-number claim does
 * (CM-41, CM-04): the number moves to `released_phone_number`, verification is cleared, and
 * every phone-released handler runs in the caller's transaction (PER-014). Sessions stay.
 *
 * Fail closed: a throwing handler aborts the caller's transaction, so the number is never
 * freed while a handler has not done its part. The number is returned to the caller only; it
 * must never reach a log (v5.0.0-16.2.5).
 *
 * @param tx - The transaction the caller also uses for its journal row and notice.
 * @param personId - The person whose number is released.
 * @returns The released number (E.164), or null for a guest or a person with no active number.
 */
export async function releaseNumberOfPerson(
  tx: Prisma.TransactionClient,
  personId: string
): Promise<string | null> {
  const phone = await findRegisteredActiveNumber(tx, personId);
  if (phone === null) return null;
  const released = await releaseRegisteredHolder(tx, phone);
  if (released === null) return null;
  await firePhoneReleased(phone, tx);
  return phone;
}
