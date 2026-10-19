import type { Prisma } from '@prisma/client';

/** What a handler receives: the number that has just been freed. */
export type PhoneReleasedEvent = { phoneNumber: string };

/** Work another module attaches to a release; it runs in the caller's transaction. */
export type PhoneReleasedHandler = (
  event: PhoneReleasedEvent,
  tx: Prisma.TransactionClient
) => Promise<void>;

// E.164 pattern of C-02.
const E164 = /^\+[1-9][0-9]{7,14}$/;

const handlers: PhoneReleasedHandler[] = [];

/**
 * Attaches a handler to run whenever a phone number is released (ADR-004: the person
 * module calls handlers without importing the modules that own them).
 * Registering the same function twice keeps one entry, in its first position.
 */
export function registerPhoneReleasedHandler(handler: PhoneReleasedHandler): void {
  if (!handlers.includes(handler)) {
    handlers.push(handler);
  }
}

/**
 * Runs every handler in registration order, one after the other, in the caller's transaction.
 *
 * Fail closed: the first handler that throws stops the chain and its error reaches the
 * caller, which rolls back, so a number is never freed while a handler has not done its part.
 * Nothing is logged here (v5.0.0-16.2.5: a phone number never reaches the logs).
 *
 * @param phoneNumber - The released number, E.164.
 * @param tx - The transaction that frees the number.
 * @throws {RangeError} when the number is not E.164 (C-02); no handler runs.
 */
export async function firePhoneReleased(
  phoneNumber: string,
  tx: Prisma.TransactionClient
): Promise<void> {
  if (!E164.test(phoneNumber)) {
    throw new RangeError('Invalid phone number');
  }
  for (const handler of [...handlers]) {
    await handler({ phoneNumber }, tx);
  }
}
