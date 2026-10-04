import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { LABEL_MAX, TEXT_MAX } from '../../shared/limits.js';
import { phoneNumberSchema } from '../../shared/phone.js';

/**
 * Strict body of the add-customer gesture: exactly four writable fields (ASVS v5.0.0-15.3.3).
 * Credit limit, balance, status, author and supplier are never accepted: the server sets them
 * (CWE-915). The number is normalized to E.164 and landlines are refused.
 */
export const addCustomerSchema = z
  .object({
    id: uuidV7Schema,
    phone_number: phoneNumberSchema,
    customer_label: z.string().trim().min(1).max(LABEL_MAX).optional(),
    delivery_address: z.string().max(TEXT_MAX).optional(),
  })
  .strict();

export type AddCustomerInput = z.infer<typeof addCustomerSchema>;
