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

describe('seedCustomerPrice', () => {
  it('writes the variant only, without reading its product', async () => {
    const findUniqueOrThrow = vi.fn();
    const create = vi.fn().mockResolvedValue(input);
    const client = {
      productVariant: { findUniqueOrThrow },
      customerPrice: { create },
    } as unknown as Prisma.TransactionClient;

    await seedCustomerPrice(client, input);

    expect(findUniqueOrThrow).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledExactlyOnceWith({ data: input });
  });

  it('propagates a database error', async () => {
    const error = new Error('Foreign key violation');
    const client = {
      customerPrice: { create: vi.fn().mockRejectedValue(error) },
    } as unknown as Prisma.TransactionClient;

    await expect(seedCustomerPrice(client, input)).rejects.toBe(error);
  });
});
