import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { LABEL_MAX, TEXT_MAX } from '../../shared/limits.js';
import { paginationQuerySchema } from '../../shared/pagination.js';

/** Path of the payment gesture: the relationship id is a UUID, so a malformed one never reaches the database. */
export const paymentParamSchema = z.object({ relationshipId: uuidV7Schema }).strict();

/**
 * Strict body of the record-payment gesture (FIN-004): the gesture id, which becomes the ledger
 * entry id, an amount in whole XAF, the cash mode, and optional reference and note. The kind, the
 * sign, the recorder and the time are never accepted: the server sets them (ASVS v5.0.0-15.3.3,
 * CWE-915). A transaction reference only makes sense for MOBILE_MONEY (C-23).
 */
export const recordPaymentSchema = z
  .object({
    id: uuidV7Schema,
    amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    mode: z.enum(['CASH', 'MOBILE_MONEY']),
    transaction_reference: z.string().trim().min(1).max(LABEL_MAX).optional(),
    note: z.string().max(TEXT_MAX).optional(),
  })
  .strict()
  .refine((body) => body.transaction_reference === undefined || body.mode === 'MOBILE_MONEY', {
    message: 'reference_only_for_mobile_money',
    path: ['transaction_reference'],
  });

export type PaymentInput = z.infer<typeof recordPaymentSchema>;

/**
 * Strict body of the credit-note gesture (FIN-006): the gesture id, an amount in whole XAF and the
 * required reason. No mode, kind, recorder or time: the server sets them (ASVS v5.0.0-15.3.3).
 */
export const creditNoteSchema = z
  .object({
    id: uuidV7Schema,
    amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    note: z.string().trim().min(1).max(TEXT_MAX),
  })
  .strict();

export type CreditNoteInput = z.infer<typeof creditNoteSchema>;

/**
 * Strict body of the opening-balance gesture (FIN-007): same fields as a credit note, the reason
 * being the notebook reference. No mode, kind, recorder or time (ASVS v5.0.0-15.3.3).
 */
export const openingBalanceSchema = creditNoteSchema;

export type OpeningBalanceInput = z.infer<typeof openingBalanceSchema>;

/**
 * Strict body of the refunded-return gesture (FIN-008): `id` becomes the credit note's id and
 * `refund_entry_id` the refund's, so a replay is recognised and the two entries never share an
 * id. One amount and one required note serve both entries; the mode is the refund's. No kind,
 * recorder or time (ASVS v5.0.0-15.3.3, CWE-915).
 */
export const returnSchema = z
  .object({
    id: uuidV7Schema,
    refund_entry_id: uuidV7Schema,
    amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    mode: z.enum(['CASH', 'MOBILE_MONEY']),
    note: z.string().trim().min(1).max(TEXT_MAX),
  })
  .strict()
  .refine((body) => body.id !== body.refund_entry_id, {
    message: 'entry_ids_must_differ',
    path: ['refund_entry_id'],
  });

export type ReturnInput = z.infer<typeof returnSchema>;

/** Path of the reversal gesture: the entry id is a UUID, so a malformed one never reaches the database. */
export const reverseParamSchema = z.object({ entryId: uuidV7Schema }).strict();

/**
 * Strict body of the reversal gesture (FIN-009): the gesture id, which becomes the mirror entry's
 * id, and an optional reason. The kind, amount, relationship, recorder and time are copied or set
 * by the server, never accepted (ASVS v5.0.0-15.3.3, CWE-915).
 */
export const reverseEntrySchema = z
  .object({
    id: uuidV7Schema,
    note: z.string().max(TEXT_MAX).optional(),
  })
  .strict();

export type ReverseEntryInput = z.infer<typeof reverseEntrySchema>;

/** Strict query of the ledger read (FIN-010): `limit` and `cursor` only; any other field is a 400. */
export const ledgerQuerySchema = paginationQuerySchema.strict();

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

/**
 * Strict body of the record-expense gesture (FIN-012): the gesture id, which becomes the expense
 * id, an optional payer (the caller when absent), an amount in whole XAF and optional category,
 * description and past `occurred_at`. The organization, the recorder and the cancellation fields
 * are never accepted: the server sets them (ASVS v5.0.0-15.3.3, CWE-915).
 */
export const recordExpenseSchema = z
  .object({
    id: uuidV7Schema,
    paid_by_id: uuidV7Schema.optional(),
    amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    category: z.string().trim().min(1).max(LABEL_MAX).optional(),
    description: z.string().max(TEXT_MAX).optional(),
    occurred_at: z
      .string()
      .datetime({ offset: true })
      .refine((value) => Date.parse(value) <= Date.now(), 'occurred_at is in the future')
      .optional(),
  })
  .strict();

export type RecordExpenseInput = z.infer<typeof recordExpenseSchema>;

/** Path of the cancel-expense gesture: the expense id is a UUID, so a malformed one never reaches the database. */
export const cancelExpenseParamSchema = z.object({ expenseId: uuidV7Schema }).strict();

/**
 * Strict body of the cancel-expense gesture (FIN-013): the gesture id only. The canceller and the
 * time are set by the server, never accepted (ASVS v5.0.0-15.3.3, CWE-915).
 */
export const cancelExpenseSchema = z.object({ id: uuidV7Schema }).strict();

export type CancelExpenseInput = z.infer<typeof cancelExpenseSchema>;

/**
 * Strict body of the record-handover gesture (FIN-015): the gesture id, which becomes the handover
 * id, the remitter, an amount in whole XAF and an optional past `occurred_at`. The receiver is the
 * caller and the organization comes from the path: neither is accepted here (ASVS v5.0.0-15.3.3,
 * CWE-915).
 */
export const recordHandoverSchema = z
  .object({
    id: uuidV7Schema,
    from_person_id: uuidV7Schema,
    amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    occurred_at: z
      .string()
      .datetime({ offset: true })
      .refine((value) => Date.parse(value) <= Date.now(), 'occurred_at is in the future')
      .optional(),
  })
  .strict();

export type RecordHandoverInput = z.infer<typeof recordHandoverSchema>;

/** Path of the cancel and dispute handover gestures: a malformed id never reaches the database. */
export const handoverParamSchema = z.object({ handoverId: uuidV7Schema }).strict();

/**
 * Strict body of the cancel-handover gesture (FIN-016): the gesture id only. The canceller and the
 * time are set by the server, never accepted (ASVS v5.0.0-15.3.3, CWE-915).
 */
export const cancelHandoverSchema = z.object({ id: uuidV7Schema }).strict();

export type CancelHandoverInput = z.infer<typeof cancelHandoverSchema>;

/**
 * Strict body of the dispute-handover gesture (FIN-016): the gesture id and an optional comment of
 * up to 2000 characters. The remitter is the caller, never a body field.
 */
export const disputeHandoverSchema = z
  .object({
    id: uuidV7Schema,
    comment: z.string().trim().min(1).max(TEXT_MAX).optional(),
  })
  .strict();

export type DisputeHandoverInput = z.infer<typeof disputeHandoverSchema>;

const DAY_MS = 86_400_000;
/** Longest period the money exceptions can cover, in days between `from` and `to`. */
export const MONEY_EXCEPTIONS_MAX_DAYS = 92;
/** Days read when no period is given: today and the six days before. */
const MONEY_EXCEPTIONS_DEFAULT_DAYS = 7;

/** True for a real calendar date written `YYYY-MM-DD` (no `2026-02-30`). */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

const isoDateSchema = z.string().refine(isCalendarDate, 'invalid_date');

/** The period a money-exceptions query covers: `from` inclusive, `toExclusive` the day after `to`. */
export type MoneyPeriod = { from: Date; toExclusive: Date };

/**
 * Turns the query dates into a UTC period: `to` defaults to today, `from` to six days before `to`
 * (seven days counted), and the whole last day is included.
 *
 * @param query - Validated `from` and `to` as `YYYY-MM-DD`, both optional.
 * @param now - Clock, injectable for tests.
 */
export function resolveMoneyPeriod(
  query: { from?: string; to?: string },
  now: Date = new Date()
): MoneyPeriod {
  const to = Date.parse(`${query.to ?? now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const from = query.from
    ? Date.parse(`${query.from}T00:00:00.000Z`)
    : to - (MONEY_EXCEPTIONS_DEFAULT_DAYS - 1) * DAY_MS;
  return { from: new Date(from), toExclusive: new Date(to + DAY_MS) };
}

/**
 * Strict query of the money exceptions (FIN-019): optional `from` and `to` as ISO dates, at most
 * 92 days apart and `from` not after `to`, defaults applied before the check. Any other field is a 400.
 */
export const moneyExceptionsQuerySchema = z
  .object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() })
  .strict()
  .superRefine((query, context) => {
    const { from, toExclusive } = resolveMoneyPeriod(query);
    const days = (toExclusive.getTime() - DAY_MS - from.getTime()) / DAY_MS;
    if (days < 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'from_after_to', path: ['from'] });
    } else if (days > MONEY_EXCEPTIONS_MAX_DAYS) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'period_too_long', path: ['to'] });
    }
  });

export type MoneyExceptionsQuery = z.infer<typeof moneyExceptionsQuerySchema>;
