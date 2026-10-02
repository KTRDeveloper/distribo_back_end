import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { decodeCursor, encodeCursor, paginationQuerySchema } from '../../../src/shared/pagination.js';

describe('pagination helpers', () => {
  describe('paginationQuerySchema', () => {
    it.each([
      [{}, 50],
      [{ limit: '1' }, 1],
      [{ limit: '100' }, 100],
    ])('parses %o as limit %d', (input, expected) => {
      expect(paginationQuerySchema.parse(input).limit).toBe(expected);
    });

    it.each([{ limit: '0' }, { limit: '101' }, { limit: 'abc' }])(
      'rejects invalid page size %o',
      (input) => {
        expect(() => paginationQuerySchema.parse(input)).toThrow(ZodError);
      },
    );
  });

  it('round-trips a cursor', () => {
    const original = {
      createdAt: new Date('2026-01-02T03:04:05.678Z'),
      id: '018f0f4e-8d8b-7c2d-9c2c-123456789abc',
    };

    const decoded = decodeCursor(encodeCursor(original));

    expect(decoded.createdAt).toEqual(original.createdAt);
    expect(decoded.id).toBe(original.id);
  });

  it.each([
    'not a cursor',
    'eyJub3QiOiJKU09OIn0',
    'eyJjcmVhdGVkQXQiOiIyMDI2LTAxLTAyVDAzOjA0OjA1LjY3OFoiLCJpZCI6Im5vdC11dWlkIn0',
  ])('rejects malformed cursor %s with a validation error', (text) => {
    try {
      decodeCursor(text);
      expect.unreachable();
    } catch (err) {
      expect(err).toHaveProperty('statusCode', 400);
      expect(err).toHaveProperty('code', 'VALIDATION_ERROR');
    }
  });
});
