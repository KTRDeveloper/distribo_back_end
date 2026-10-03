import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { httpError } from '../../lib/http-error.js';
import { uuidV7Schema } from '../../shared/ids.js';
import { LABEL_MAX, TEXT_MAX } from '../../shared/limits.js';
import { notificationRepository } from './notification.repository.js';

export type NotifyInput = {
  recipientId: string;
  organizationId?: string;
  sourceEvent: string;
  content: string;
  related?: { type: string; id: string };
};

const nonblank = (value: string): boolean => value.trim().length > 0;

function isLowercaseLetter(character: string): boolean {
  return character >= 'a' && character <= 'z';
}

function isCanonicalSourceEvent(value: string): boolean {
  const segments = value.split('.');
  if (segments.length < 2) return false;
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      isLowercaseLetter(segment[0] ?? '') &&
      [...segment].every(
        (character) =>
          isLowercaseLetter(character) ||
          (character >= '0' && character <= '9') ||
          character === '_'
      )
  );
}

const notifyInputSchema = z
  .object({
    recipientId: uuidV7Schema,
    organizationId: uuidV7Schema.optional(),
    sourceEvent: z.string().max(LABEL_MAX).refine(isCanonicalSourceEvent),
    content: z.string().max(TEXT_MAX).refine(nonblank),
    related: z
      .object({
        type: z.string().max(LABEL_MAX).refine(nonblank),
        id: uuidV7Schema,
      })
      .strict()
      .optional(),
  })
  .strict();

function validationError(): Error {
  return httpError(400, 'VALIDATION_ERROR', 'Invalid notification input');
}

/**
 * Stores an unread notification for a registered person in the caller's transaction when supplied.
 * Validation deliberately gives missing and guest recipients the same safe error.
 *
 * @param input - Bounded notification fields already localized by the caller.
 * @param tx - Optional transaction that must cover both eligibility lookup and insertion.
 * @throws An HTTP 400 `VALIDATION_ERROR` when input or recipient eligibility is invalid.
 */
export async function notify(input: NotifyInput, tx?: Prisma.TransactionClient): Promise<void> {
  const parsed = notifyInputSchema.safeParse(input);
  if (!parsed.success) throw validationError();

  const recipient = await notificationRepository.findRecipient(parsed.data.recipientId, tx);
  if (!recipient || recipient.registeredAt === null) throw validationError();

  await notificationRepository.create(parsed.data, tx);
}

/**
 * Returns the language in which callers should compose a registered person's notification.
 *
 * @param personId - Canonical UUIDv7 person identifier.
 * @param tx - Optional transaction used for the recipient lookup.
 * @returns The saved language, defaulting an empty preference to French.
 * @throws An HTTP 400 `VALIDATION_ERROR` for an invalid, missing, or guest person.
 */
export async function recipientLanguage(
  personId: string,
  tx?: Prisma.TransactionClient
): Promise<'FR' | 'EN'> {
  const parsedId = uuidV7Schema.safeParse(personId);
  if (!parsedId.success) throw validationError();

  const recipient = await notificationRepository.findRecipient(parsedId.data, tx);
  if (!recipient || recipient.registeredAt === null) throw validationError();
  return recipient.preferredLanguage ?? 'FR';
}
