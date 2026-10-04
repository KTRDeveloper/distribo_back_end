import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { LABEL_MAX, TEXT_MAX } from '../../shared/limits.js';

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
