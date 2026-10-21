import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sources = [
  [
    'delivery/abandoned-rests.test.ts',
    readFileSync('tests/integration/delivery/abandoned-rests.test.ts', 'utf8'),
  ],
  ['delivery/assign.test.ts', readFileSync('tests/integration/delivery/assign.test.ts', 'utf8')],
  [
    'delivery/counter-sale.test.ts',
    readFileSync('tests/integration/delivery/counter-sale.test.ts', 'utf8'),
  ],
  ['delivery/deliver.test.ts', readFileSync('tests/integration/delivery/deliver.test.ts', 'utf8')],
  ['delivery/depart.test.ts', readFileSync('tests/integration/delivery/depart.test.ts', 'utf8')],
  [
    'delivery/driver-lists.test.ts',
    readFileSync('tests/integration/delivery/driver-lists.test.ts', 'utf8'),
  ],
  ['delivery/fail.test.ts', readFileSync('tests/integration/delivery/fail.test.ts', 'utf8')],
  [
    'delivery/partial-delivery.test.ts',
    readFileSync('tests/integration/delivery/partial-delivery.test.ts', 'utf8'),
  ],
  [
    'delivery/unstarted-cleanup.test.ts',
    readFileSync('tests/integration/delivery/unstarted-cleanup.test.ts', 'utf8'),
  ],
  [
    'finance/money-exceptions.test.ts',
    readFileSync('tests/integration/finance/money-exceptions.test.ts', 'utf8'),
  ],
] as const;

describe('DLV-016 delivery and finance product fixtures', () => {
  it.each(sources)(
    'no old columns: %s seeds products through the catalog helper (AC-1)',
    (_file, source) => {
      expect(source).not.toMatch(/\bproduct\s*\.\s*create(?:Many)?\s*\(/);
      expect(source).not.toMatch(/\bINSERT\s+INTO\s+"?products"?\b/i);
      expect(source).toMatch(
        /import\s*\{\s*seedProduct\s*\}\s*from\s*['"]\.\.\/\.\.\/helpers\/catalog-fixtures\.js['"]/
      );
      expect(source).toMatch(/\bseedProduct\s*\(\s*prisma\s*,/);
    }
  );
});
