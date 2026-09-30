/**
 * Generate a unique, plausible-looking (digits-only) phone number for test
 * fixtures. Avoids collisions across parallel test runs without needing DB
 * cleanup coordination between them.
 */
export function uniquePhone(): string {
  const digits = `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(-9);
  return `+221${digits}`;
}
