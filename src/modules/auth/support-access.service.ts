import type { Prisma } from '@prisma/client';
import { firePhoneReleased } from '../person/phone-released.js';
import { newId } from '../../shared/ids.js';
import {
  findRegisteredActiveNumber,
  movePhoneNumber,
  releaseRegisteredHolder,
} from './auth.repository.js';

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

/**
 * Replaces the active number of a person by `newPhone`, verified now, the way a number change
 * does (CM-40, CM-04): the person row is locked, a PhoneNumberChangeLog row keeps the old and
 * the new number, and both stand or fall with the caller's transaction. The caller has already
 * checked the two codes; this function checks no code. Sessions are left to the caller.
 *
 * @param tx - The transaction the caller also uses for its journal row, notice and sign-out.
 * @param personId - The person whose number is replaced.
 * @param newPhone - The new number (E.164).
 * @returns false when the person has no number to replace.
 * @throws a Prisma P2002 error when another person holds the number (the caller maps it to PHONE_TAKEN).
 */
export function moveAccountToNumber(
  tx: Prisma.TransactionClient,
  personId: string,
  newPhone: string
): Promise<boolean> {
  return movePhoneNumber(tx, personId, newPhone, newId());
}
