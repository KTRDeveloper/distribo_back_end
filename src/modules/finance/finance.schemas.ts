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
