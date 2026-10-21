import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
  'accept-order',
  'cancel-order-customer',
  'cancel-order-supplier',
  'customer-orders',
  'edit-order',
  'enter-order',
  'get-order',
  'line-rules',
  'list-orders',
  'order-line-table',
  'order-note',
  'place-order',
  'place-purchase',
  'refuse-order',
  'total-check',
];

describe('ORD-031 catalog fixtures', () => {
  describe.each(files)('%s', (file) => {
    const source = readFileSync(
      new URL(`../../integration/order/${file}.test.ts`, import.meta.url),
      'utf8'
    );

    it('creates products only through the catalog helper', () => {
      expect(source).toMatch(
        /import\s*\{[^}]*\bseedProduct\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/helpers\/catalog-fixtures\.js['"]/
      );
      expect(source).not.toMatch(/\bINSERT\s+INTO\s+products\b/i);
      expect(source).not.toMatch(/\bprisma\.product\.create(?:Many)?\s*\(/);
    });

    it('does not update legacy variant fields on products', () => {
      const sqlUpdates = source.match(/\bUPDATE\s+products\s+SET\b[^`]*?(?=\bWHERE\b|`)/gi) ?? [];
      for (const update of sqlUpdates) {
        expect(update).not.toMatch(/\b(?:status|price|min_order_quantity)\s*=/i);
      }
      const ormUpdates =
        source.match(/\bprisma\.product\.update(?:Many)?\s*\([\s\S]*?\}\s*\)/g) ?? [];
      for (const update of ormUpdates) {
        expect(update).not.toMatch(/\b(?:status|price|minOrderQuantity)\s*:/);
      }
    });
  });
});
