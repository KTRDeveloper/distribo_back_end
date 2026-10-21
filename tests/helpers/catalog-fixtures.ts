import type { Prisma } from '@prisma/client';

export type SeedProductInput = {
  id: string;
  organizationId: string;
  name?: string;
  unit?: string;
  price?: bigint;
  minOrderQuantity?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  variantName?: string | null;
  pausedAt?: Date | null;
  deletedAt?: Date | null;
};

/**
 * Seeds a product and its same-id variant so legacy references keep resolving.
 * @param client Prisma client or enclosing transaction client; the caller owns the transaction.
 * @param input Fake product and variant values; legacy product columns keep their defaults.
 * @returns The product and variant identifiers, both equal to the supplied id.
 */
export async function seedProduct(
  client: Prisma.TransactionClient,
  input: SeedProductInput
): Promise<{ productId: string; variantId: string }> {
  await client.product.create({
    data: {
      id: input.id,
      organizationId: input.organizationId,
      name: input.name ?? 'Product',
      pausedAt: input.pausedAt ?? null,
      deletedAt: input.deletedAt ?? null,
    },
  });
  const variant = {
    productId: input.id,
    organizationId: input.organizationId,
    name: input.variantName ?? null,
    unit: input.unit ?? 'kg',
    price: input.price ?? 1000n,
    minOrderQuantity: input.minOrderQuantity ?? null,
    status: input.status ?? 'ACTIVE',
    deletedAt: input.deletedAt ?? null,
  };
  // CAT-014 may already have mirrored the product; this also works after those triggers go.
  await client.productVariant.upsert({
    where: { id: input.id },
    create: { id: input.id, ...variant },
    update: variant,
  });
  return { productId: input.id, variantId: input.id };
}
