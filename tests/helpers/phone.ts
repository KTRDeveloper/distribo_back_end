/**
 * Generate a unique, valid Cameroon mobile number for test fixtures.
 * Avoids collisions across parallel test runs without needing DB cleanup.
 * Returns numbers in E.164 format: +237 followed by a mobile prefix (5-9) and 8 more digits.
 */
export function uniquePhone(): string {
  // Generate 9 digits: first digit is 5-9 (mobile prefix), rest are random
  const mobilePrefix = Math.floor(Math.random() * 5) + 5; // 5-9
  const remainingDigits = Math.floor(Math.random() * 100000000)
    .toString()
    .padStart(8, '0');
  return `+237${mobilePrefix}${remainingDigits}`;
}
