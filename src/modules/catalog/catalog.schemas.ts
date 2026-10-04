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

/**
 * Strict query of the customer's catalog (ASVS v5.0.0-2.2.1): page size, cursor and the
 * optional organization the caller buys for. Unknown keys are rejected.
 */
export const browseCatalogQuerySchema = paginationQuerySchema
  .extend({ as_organization_id: uuidV7Schema.optional() })
  .strict();

export type BrowseQuery = z.infer<typeof browseCatalogQuerySchema>;

/** One article as a customer sees it: the caller's own price, nothing of the supplier side. */
export type CatalogItemView = {
  id: string;
  name: string;
  unit: string;
  price: number;
  min_order_quantity: string | null;
  description: string | null;
  category: string | null;
  price_is_negotiated: boolean;
};

/** Response of the customer's catalog. */
export type CatalogPage = { items: CatalogItemView[]; next_cursor: string | null };

/** Path of the negotiated price gesture: supplier organization, customer relationship, article. */
export const customerPriceParamsSchema = z.object({
  organizationId: uuidV7Schema,
  relationshipId: uuidV7Schema,
  productId: uuidV7Schema,
});

/**
 * Strict body of the negotiated price gesture (ASVS v5.0.0-15.3.3): the gesture id and a whole
 * XAF price of at least 1. The author, the time and the product come from the session and the
 * path, never from the body (CWE-915).
 */
export const setCustomerPriceSchema = z
  .object({
    id: uuidV7Schema,
    price: z.number().int().safe().min(1),
  })
  .strict();

export type SetCustomerPriceInput = z.infer<typeof setCustomerPriceSchema>;

/** Closed response of the negotiated price gesture. */
export type CustomerPriceView = {
  product_id: string;
  price: number;
  set_by_id: string;
  set_at: string;
};

/** Path of the negotiated price list: supplier organization and customer relationship. */
export const customerPricesParamsSchema = z.object({
  organizationId: uuidV7Schema,
  relationshipId: uuidV7Schema,
});

/** Strict query of the negotiated price list: page size and cursor only. */
export const listCustomerPricesQuerySchema = paginationQuerySchema.strict();

export type ListCustomerPricesQuery = z.infer<typeof listCustomerPricesQuerySchema>;

/**
 * One live negotiated price as the supplier's staff sees it. `to_review` is true when the
 * article price changed after the negotiated price was set.
 */
export type CustomerPriceListItem = {
  product_id: string;
  product_name: string;
  price: number;
  product_price: number;
  set_by_id: string;
  set_at: string;
  to_review: boolean;
};

/** Response of the negotiated price list. */
export type CustomerPricePage = { items: CustomerPriceListItem[]; next_cursor: string | null };

/**
 * Strict body of the copy gesture (ASVS v5.0.0-15.3.3): the gesture id and the source
 * relationship. The target is the path's relationship; the author comes from the session.
 */
export const copyCustomerPricesSchema = z
  .object({
    id: uuidV7Schema,
    from_relationship_id: uuidV7Schema,
  })
  .strict();

export type CopyCustomerPricesInput = z.infer<typeof copyCustomerPricesSchema>;

/** Response of the copy gesture: how many live prices the target now holds from the source. */
export type CopyCustomerPricesView = { copied: number };

/**
 * Strict body of the copy-article gesture (ASVS v5.0.0-15.3.3): the gesture id, the source
 * article and the caller's own price. Texts come from the source, the organization and the
 * status from the server (CWE-915).
 */
export const copyProductSchema = z
  .object({
    id: uuidV7Schema,
    source_product_id: uuidV7Schema,
    price: z.number().int().safe().min(1),
  })
  .strict();

export type CopyProductInput = z.infer<typeof copyProductSchema>;
