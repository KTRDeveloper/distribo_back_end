import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { NAME_MAX, TEXT_MAX } from '../../shared/limits.js';
import { parseQuantity } from '../../shared/money.js';
import { paginationQuerySchema } from '../../shared/pagination.js';

/** Largest quantity `numeric(12,3)` holds, in thousandths. */
const QUANTITY_MAX_MILLI = 999_999_999_999n;

/**
 * Minimum order quantity: a decimal string or a number, greater than 0, at most 3 decimals and
 * within `numeric(12,3)`. Checked before any database call (ASVS v5.0.0-2.2.1, C-13). The output
 * is the canonical string, so parsing an already parsed body gives the same value.
 */
const minOrderQuantitySchema = z.union([z.number(), z.string().max(32)]).transform((value, ctx) => {
  const text = typeof value === 'number' ? String(value) : value;
  try {
    const milli = parseQuantity(text);
    if (milli > 0n && milli <= QUANTITY_MAX_MILLI) return text;
  } catch {
    // A malformed quantity is reported as a validation issue below, never as a 500.
  }
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_quantity' });
  return z.NEVER;
});

/**
 * Strict body of the create gesture (ASVS v5.0.0-15.3.3): status, organization and
 * `price_updated_at` are never accepted, the server sets them (CWE-915). Limits from Q-027.
 */
export const createProductSchema = z
  .object({
    id: uuidV7Schema,
    name: z.string().trim().min(1).max(NAME_MAX),
    unit: z.string().trim().min(1).max(NAME_MAX),
    price: z.number().int().safe().min(1),
    min_order_quantity: minOrderQuantitySchema.optional(),
    description: z.string().max(TEXT_MAX).optional(),
    category: z.string().trim().max(NAME_MAX).optional(),
  })
  .strict();

export type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * Strict body of the edit gesture (ASVS v5.0.0-15.3.3): only the listed fields, at least one.
 * `min_order_quantity: null` clears it; every other field keeps the create limits. The
 * organization and `price_updated_at` are never accepted, the server owns them (C-13, CWE-915).
 */
export const editProductSchema = z
  .object({
    name: z.string().trim().min(1).max(NAME_MAX),
    unit: z.string().trim().min(1).max(NAME_MAX),
    price: z.number().int().safe().min(1),
    min_order_quantity: minOrderQuantitySchema.nullable(),
    description: z.string().max(TEXT_MAX),
    category: z.string().trim().max(NAME_MAX),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'at_least_one_field' });

export type EditProductInput = z.infer<typeof editProductSchema>;

/** Closed response of the create gesture. */
export type ProductView = {
  id: string;
  name: string;
  unit: string;
  price: number;
  price_updated_at: string;
  min_order_quantity: string | null;
  description: string | null;
  category: string | null;
  status: string;
  created_at: string;
};

/**
 * Strict query of the product list (ASVS v5.0.0-2.2.1): page size and cursor, an optional
 * status or exact category, and `q`, a name search of 1 to 100 characters. Unknown keys are
 * rejected.
 */
export const listProductsQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    category: z.string().min(1).max(NAME_MAX).optional(),
    q: z.string().min(1).max(100).optional(),
  })
  .strict();

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

/** Response of the product list. */
export type ProductPage = { items: ProductView[]; next_cursor: string | null };
