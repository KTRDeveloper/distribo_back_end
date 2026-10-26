/**
 * Guards that the synchronization tests seed products through the catalog helper (SYNC-043).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = [
  'controls-credit',
  'controls-prices',
  'exceptions',
  'forbidden-sends',
  'judge',
  'pull-catalog',
  'pull-orders',
  'pull-relationships',
  'push-closing',
  'push-orders',
  'replay',
  'rights-change',
].map((name) => `tests/integration/sync/${name}.test.ts`);

const source = (file: string) => readFileSync(file, 'utf8');

describe('Synchronization tests seed products through the catalog helper', () => {
  describe('AC-1: no test inserts the old columns', () => {
    it.each(FILES)('%s uses seedProduct and no direct product insert', (file) => {
      const text = source(file);
      expect(text).toMatch(/helpers\/catalog-fixtures/);
      expect(text).not.toMatch(/prisma\.product\.(create|createMany|upsert)\(/);
      expect(text).not.toMatch(/INSERT INTO products/i);
    });

    it.each(FILES)('%s updates neither price nor status on products', (file) => {
      const text = source(file);
      expect(text).not.toMatch(/prisma\.product\.update\(\{[^)]*\b(price|status)\b/);
      expect(text).not.toMatch(/UPDATE products SET[^`]*\b(price|status)\b/i);
    });
  });
});
