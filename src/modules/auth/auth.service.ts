import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { httpError } from '../../lib/http-error.js';
import { normalizeE164 } from '../../shared/phone.js';
import { findByActivePhone } from '../person/person.repository.js';
import { issueCode, type ClientKeys } from './otp.service.js';

const EXPIRES_IN_SECONDS = 600;

/** First word in full, then the initial of each further word and "…" (one word: its initial and "…"). */
export function maskName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const [first = '', ...rest] = words;
  if (rest.length === 0) return `${Array.from(first)[0] ?? ''}…`;
  return `${first} ${rest.map((w) => Array.from(w)[0] ?? '').join(' ')}…`;
}

/**
 * Send a REGISTRATION code to a +237 mobile (CM-07, v5.0.0-6.6.1). Foreign or
 * invalid numbers are refused before any limit is consumed or SMS queued.
 * `masked_name` is the one deliberate disclosure (v5.0.0-6.3.8).
 *
 * @throws 400 VALIDATION_ERROR, 400 UNSUPPORTED_NUMBER, 429 OTP_RATE_LIMITED
 */
export async function requestRegistrationCode(
  input: { phone_number: string },
  clientKeys: ClientKeys = {}
): Promise<{ sent: true; expires_in: number; existing_account: { masked_name: string } | null }> {
  const phone = normalizeE164(input.phone_number);
  if (phone === null) {
    const parsed = parsePhoneNumberFromString(input.phone_number, 'CM');
    if (parsed?.isValid() && parsed.country !== 'CM') {
      throw httpError(400, 'UNSUPPORTED_NUMBER', 'This number is not supported');
    }
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
  }

  const holder = await findByActivePhone(phone);
  const registered = holder?.registeredAt != null && holder.fullName;
  await issueCode(
    {
      personId: holder?.id ?? null,
      target: phone,
      purpose: 'REGISTRATION',
      channel: 'SMS',
      ...(registered ? {} : { language: 'FR' as const }),
    },
    clientKeys
  );
  return {
    sent: true,
    expires_in: EXPIRES_IN_SECONDS,
    existing_account: registered ? { masked_name: maskName(holder.fullName ?? '') } : null,
  };
}
