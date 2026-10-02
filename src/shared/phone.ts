/**
 * Phone number normalization and validation using libphonenumber-js.
 * Ensures all phone numbers are in E.164 format and validates Cameroon mobiles.
 * v5.0.0-2.2.1: refuse landlines and non-numbers
 */

import { parsePhoneNumber } from 'libphonenumber-js/max';
import { z } from 'zod';

/**
 * Normalize a phone number to E.164 format.
 * Accepts various formats (with/without country code, with spaces, with +, 00, etc.).
 * Only valid Cameroon mobile numbers are accepted; landlines return null.
 * Cameroon mobiles: +237 followed by 6-9 (mobile prefix) then 7 digits (9 total).
 *
 * @param input - The phone number string to normalize
 * @returns The E.164-formatted number (e.g., "+237677123456") or null if invalid
 */
export function normalizeE164(input: string): string | null {
  try {
    // Always parse with CM as the default region to handle numbers without country code
    const parsed = parsePhoneNumber(input, 'CM');
    if (!parsed) {
      return null;
    }

    const e164 = parsed.format('E.164');

    // Validate Cameroon mobile format: +237 followed by 9 digits (first digit 5-9)
    // Pattern: +237[5-9]\d{8} = +237 + 9 digits, first is 5-9 (mobile prefix)
    if (!/^\+237[5-9]\d{8}$/.test(e164)) {
      return null;
    }

    return e164;
  } catch {
    return null;
  }
}

/**
 * Check if a phone number is a valid Cameroon mobile.
 * Validates against E.164 format and Cameroon mobile number pattern.
 *
 * @param e164 - The phone number in E.164 format
 * @returns true if the number matches Cameroon mobile format, false otherwise
 */
export function isCameroonMobile(e164: string): boolean {
  try {
    // First validate it's a properly formatted E.164 number for Cameroon
    const parsed = parsePhoneNumber(e164);
    if (!parsed) {
      return false;
    }

    // Check country code is Cameroon (237)
    if (parsed.country !== 'CM') {
      return false;
    }

    // Validate Cameroon mobile format: +237 followed by 9 digits (first digit 5-9)
    const formatted = parsed.format('E.164');
    if (!/^\+237[5-9]\d{8}$/.test(formatted)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Zod schema for validating and normalizing phone numbers.
 * Accepts various formats and normalizes to E.164.
 * Rejects landlines and invalid numbers without echoing the input.
 * v5.0.0-2.2.1: validation error messages do not contain the entered value
 */
export const phoneNumberSchema = z
  .string()
  .min(1, 'Phone number is required')
  .transform((input) => normalizeE164(input))
  .refine((normalized) => normalized !== null, {
    message: 'Invalid phone number or not a Cameroon mobile',
  })
  .transform((normalized) => normalized ?? '');
