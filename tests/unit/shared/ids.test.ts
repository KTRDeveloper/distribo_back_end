/**
 * Tests for shared UUIDv7 identifiers and database column assertions.
 */

import { describe, expect, it } from 'vitest';
import { newId, uuidV7Schema } from '../../../src/shared/ids.js';
import { expectColumnType } from '../../helpers/db-schema.js';
import { prisma } from '../../setup.js';

describe('shared identifiers', () => {
  it('creates 1000 distinct UUIDv7 identifiers', () => {
    const identifiers = Array.from({ length: 1000 }, () => newId());

    expect(new Set(identifiers).size).toBe(identifiers.length);
    for (const identifier of identifiers) {
      expect(uuidV7Schema.safeParse(identifier).success).toBe(true);
    }
  });

  it.each([
    ['a valid UUIDv7', '018f0b7f-7b6e-7abc-8def-0123456789ab', true],
    ['a UUIDv4', '018f0b7f-7b6e-4abc-8def-0123456789ab', false],
    ['a non-UUID value', '123', false],
    ['an uppercase UUIDv7', '018F0B7F-7B6E-7ABC-8DEF-0123456789AB', true],
  ])('%s is parsed as expected', (_description, value, accepted) => {
    expect(uuidV7Schema.safeParse(value).success).toBe(accepted);
  });
});

describe('database column type helper', () => {
  it('accepts the expected PostgreSQL types and rejects a wrong type', async () => {
    await prisma.$executeRaw`
      CREATE TABLE fnd005_column_type_helper (
        id uuid NOT NULL,
        amount bigint NOT NULL,
        quantity numeric(12, 3) NOT NULL,
        at timestamptz NOT NULL
      )
    `;

    try {
      await expectColumnType('fnd005_column_type_helper', 'id', 'uuid');
      await expectColumnType('fnd005_column_type_helper', 'amount', 'bigint');
      await expectColumnType('fnd005_column_type_helper', 'quantity', 'numeric', [12, 3]);
      await expectColumnType('fnd005_column_type_helper', 'at', 'timestamptz');
      await expect(
        expectColumnType('fnd005_column_type_helper', 'amount', 'uuid'),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRaw`DROP TABLE fnd005_column_type_helper`;
    }
  });
});
