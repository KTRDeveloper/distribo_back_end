import { z } from 'zod';

/** Same 32 symbols as `generatePaymentCode`: no 0, O, 1 or I. */
const PAYMENT_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

/**
 * Code typed on the payment site: trimmed and upper-cased, then exactly 8 symbols of the
 * payment alphabet. The raw length is capped first so a huge input is never processed.
 */
export const paymentCodeSchema = z
  .string()
  .max(64)
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.string().regex(PAYMENT_CODE_PATTERN));

export const shopParamsSchema = z.object({ code: paymentCodeSchema }).strict();

/** Documents the shop answer: the name only (ASVS v5.0.0-15.3.1). */
export const shopResponseSchema = z.object({ name: z.string() }).strict();

/** Documents the raw `code` path parameter before cleaning. */
export const shopParamsOpenApiSchema = z.object({ code: z.string() });
