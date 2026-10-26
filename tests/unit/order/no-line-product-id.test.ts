import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const THIS_FILE = 'tests/unit/order/no-line-product-id.test.ts';

// Tests whose subject is the `product_id` column itself: the filling and checking triggers of
// ORD-024, ORD-025 and ORD-032. They cannot name the column less than they test it. ORD-034 drops
// the column and rewrites them, then this list goes.
const COLUMN_TESTS = new Set([
  'tests/integration/order/order-line-variant.test.ts',
  'tests/integration/order/order-line-variant-required.test.ts',
  'tests/integration/order/line-product-optional.test.ts',
  'tests/integration/order/line-rules-variant.test.ts',
]);

// `productId` used as a property name of the created object, longhand or shorthand; a value such as
// `productVariantId: productId` or `options.productId` is not a write of the product.
const PRODUCT_KEY = /(?:^|[{,])\s*productId\s*(?::|,|\})/m;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** The text from the bracket at `open` to its closing bracket, strings and comments ignored. */
function balancedFrom(text: string, open: number): string {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (pairs[char] !== undefined) depth += 1;
    else if (char === ')' || char === '}' || char === ']') depth -= 1;
    if (depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/** True when the source inserts into `order_lines` with `product_id`, or creates a line with `productId`. */
function writesLineProduct(text: string): boolean {
  for (const match of text.matchAll(/INSERT\s+INTO\s+order_lines\s*\(([^)]*)\)/gi)) {
    if (/\bproduct_id\b/.test(match[1] ?? '')) return true;
  }
  const creations = /orderLine\.(?:create|createMany)\s*\(|\blines\s*:\s*\{\s*create\b/g;
  for (const match of text.matchAll(creations)) {
    const open = text.indexOf(match[0].endsWith('(') ? '(' : '{', match.index);
    const start = match[0].endsWith('(') ? open : text.indexOf('{', match.index);
    if (PRODUCT_KEY.test(balancedFrom(text, start))) return true;
  }
  return false;
}

describe('no file writes the product of an order line (ORD-033)', () => {
  it('AC-4: reads src/ and tests/ and lists no path', () => {
    const listed = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'tests'))]
      .map((file) => relative(ROOT, file))
      .filter((file) => file !== THIS_FILE && !COLUMN_TESTS.has(file))
      .filter((file) => writesLineProduct(readFileSync(join(ROOT, file), 'utf8')));
    expect(listed).toEqual([]);
  });

  it('the scan recognizes both ways of writing it', () => {
    expect(writesLineProduct('INSERT INTO order_lines (id, order_id, product_id) VALUES (1)')).toBe(
      true
    );
    expect(writesLineProduct('tx.orderLine.create({ data: { id, productId: P } })')).toBe(true);
    expect(
      writesLineProduct('order.create({ data: { lines: { create: [{ productId: P }] } } })')
    ).toBe(true);
    expect(writesLineProduct('INSERT INTO order_lines (id, order_id, product_variant_id) V')).toBe(
      false
    );
    expect(writesLineProduct('tx.orderLine.create({ data: { productVariantId: V } })')).toBe(false);
    expect(
      writesLineProduct(
        'tx.orderLine.create({ data: { productVariantId: productId, a: o.productId } })'
      )
    ).toBe(false);
  });
});
