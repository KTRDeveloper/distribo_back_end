import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { seedCustomerPrice } from '../../helpers/catalog-fixtures.js';

const input = {
  id: '0199c042-0000-7000-8000-000000000001',
  customerRelationshipId: '0199c042-0000-7000-8000-000000000002',
  productVariantId: '0199c042-0000-7000-8000-000000000003',
  price: 2800n,
  setById: '0199c042-0000-7000-8000-000000000004',
};

const parentId = '0199c042-0000-7000-8000-000000000005';

describe('seedCustomerPrice compatibility', () => {
  it('derives the legacy parent from the variant rather than assuming equal IDs', async () => {
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ productId: parentId });
    const create = vi.fn().mockResolvedValue({ ...input, productId: parentId });
    const client = {
      productVariant: { findUniqueOrThrow },
      customerPrice: { create },
    } as unknown as Prisma.TransactionClient;

    await seedCustomerPrice(client, input);

    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: input.productVariantId },
      select: { productId: true },
    });
    expect(create).toHaveBeenCalledExactlyOnceWith({ data: { ...input, productId: parentId } });
  });

  it('propagates a missing variant error without writing a price', async () => {
    const error = new Error('Variant not found');
    const create = vi.fn();
    const client = {
      productVariant: { findUniqueOrThrow: vi.fn().mockRejectedValue(error) },
      customerPrice: { create },
    } as unknown as Prisma.TransactionClient;

    await expect(seedCustomerPrice(client, input)).rejects.toBe(error);
    expect(create).not.toHaveBeenCalled();
  });
});
