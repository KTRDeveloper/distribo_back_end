import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { OrganizationContact } from '@prisma/client';
import type { Actor } from '../../types/express.js';
import { httpError } from '../../lib/http-error.js';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { normalizeE164 } from '../../shared/phone.js';
import { issueCode, verifyCode } from '../auth/otp.service.js';
import { findByActivePhone } from '../person/person.repository.js';
import {
  findContactConflict,
  findLiveContact,
  markContactVerified,
  insertPhoneContact,
  isUniqueViolation,
  type ContactConflict,
} from './organization-contact.repository.js';
import { findOrganization, runInTransaction } from './organization.repository.js';
import type { AddContactInput, ContactView } from './organization-contact.schemas.js';

function toContactView(row: OrganizationContact): ContactView {
  return {
    id: row.id,
    kind: row.kind,
    slot: row.slot,
    value: row.value,
    verified_at: row.verifiedAt?.toISOString() ?? null,
    verification_method: row.verificationMethod,
    created_at: row.createdAt.toISOString(),
  };
}

function conflictError(conflict: Exclude<ContactConflict, null>) {
  return conflict === 'SLOT_TAKEN'
    ? httpError(409, 'CONTACT_SLOT_TAKEN', 'This place is already taken')
    : httpError(409, 'CONTACT_ALREADY_EXISTS', 'This number is already listed');
}

/**
 * Turns the typed number into E.164. A well-formed number that is not a Cameroon mobile
 * (foreign, or a landline) answers UNSUPPORTED_NUMBER; text that is no number at all answers
 * VALIDATION_ERROR. The input is never echoed (ASVS v5.0.0-2.2.1).
 */
function normalizeOrRefuse(value: string): string {
  const phone = normalizeE164(value);
  if (phone !== null) return phone;
  if (parsePhoneNumberFromString(value, 'CM')?.isValid()) {
    throw httpError(400, 'UNSUPPORTED_NUMBER', 'This number is not supported');
  }
  throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
}

/**
 * Adds a phone number to the business as a public contact (ORG-024, C-43, C-44).
 *
 * The caller is the OWNER, checked by the route. The owner's own active number, when its
 * ownership is verified, is stored verified at once (`OWNER_PHONE`, no code); any other number
 * is stored pending and a code goes to it by SMS, tied to this contact, so a number is never
 * shown on proof from the owner alone (CWE-290). The row is committed before the code is issued
 * because the code references it; if the code cannot be sent (429 OTP_RATE_LIMITED) the contact
 * stays pending and the owner resends (ORG-026). A request that loses a race on the unique
 * indexes is answered like the pre-check.
 *
 * @param actor - Owner loaded from the path.
 * @param input - Validated body: gesture id, slot and number.
 * @returns The closed contact view.
 * @throws 400 `UNSUPPORTED_NUMBER`, 409 `ORGANIZATION_NOT_ACTIVE`, 409 `CONTACT_SLOT_TAKEN`,
 *   409 `CONTACT_ALREADY_EXISTS`, 429 `OTP_RATE_LIMITED`.
 */
export async function addContact(actor: Actor, input: AddContactInput): Promise<ContactView> {
  const value = normalizeOrRefuse(input.value);
  const holder = await findByActivePhone(value);
  const isOwnVerifiedNumber = holder?.id === actor.personId && holder.phoneVerifiedAt !== null;

  let row: OrganizationContact;
  try {
    row = await runInTransaction(async (tx) => {
      await assertOrganizationActive(actor.organizationId, tx);
      const conflict = await findContactConflict(actor.organizationId, input.slot, value, tx);
      if (conflict) throw conflictError(conflict);
      return insertPhoneContact(tx, {
        id: input.id,
        organizationId: actor.organizationId,
        slot: input.slot,
        value,
        createdById: actor.personId,
        verified: isOwnVerifiedNumber,
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lost a race: answer as the pre-check would have, from the committed state.
    const conflict = await findContactConflict(actor.organizationId, input.slot, value);
    if (conflict) throw conflictError(conflict);
    throw error;
  }

  if (!isOwnVerifiedNumber) {
    const organization = await findOrganization(actor.organizationId);
    if (!organization) throw httpError(404, 'NOT_FOUND', 'Not found');
    await issueCode({
      personId: actor.personId,
      target: value,
      purpose: 'ORG_CONTACT_VERIFICATION',
      channel: 'SMS',
      contact: { id: row.id, organizationName: organization.name },
    });
  }
  return toContactView(row);
}

/**
 * Publishes a pending contact once the owner enters the code sent to it (ORG-025, C-44, C-33).
 *
 * The contact must be live and of this business, else 404; a verified one answers 409 before
 * any code is touched, so no attempt is spent. The code is checked against the challenge tied
 * to this contact only, so the code of another business listing the same number never works
 * (ASVS v5.0.0-6.6.3, CWE-290); its errors (400 OTP_INVALID, 400 OTP_EXPIRED, 429 OTP_LOCKED)
 * pass through. Only then does one guarded UPDATE set `verified_at` and method CODE; if a
 * parallel request or a deletion got there first, no row changes and the answer is 404.
 *
 * @param actor - Owner loaded from the path.
 * @param contactId - Contact from the path.
 * @param code - Six digits, already validated.
 * @returns The closed contact view.
 * @throws 404 `NOT_FOUND`, 409 `CONTACT_ALREADY_VERIFIED`, 400 `OTP_INVALID`, 400 `OTP_EXPIRED`,
 *   429 `OTP_LOCKED`.
 */
export async function confirmContact(
  actor: Actor,
  contactId: string,
  code: string
): Promise<ContactView> {
  const contact = await findLiveContact(contactId, actor.organizationId);
  if (!contact) throw httpError(404, 'NOT_FOUND', 'Not found');
  if (contact.verifiedAt !== null) {
    throw httpError(409, 'CONTACT_ALREADY_VERIFIED', 'This contact is already verified');
  }
  await verifyCode({
    target: contact.value,
    purpose: 'ORG_CONTACT_VERIFICATION',
    code,
    organizationContactId: contact.id,
  });
  const verified = await markContactVerified(contact.id, actor.organizationId, new Date());
  if (!verified) throw httpError(404, 'NOT_FOUND', 'Not found');
  return toContactView(verified);
}
