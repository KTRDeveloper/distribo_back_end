import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const SCANNED = ['src', 'tests'];
/** Files that name the dropped column on purpose: this scan and the test of the drop. */
const EXEMPT = new Set([
  'tests/unit/catalog/no-price-product-id.test.ts',
  'tests/integration/catalog/price-product-dropped.test.ts',
]);

const RAW_INSERT = /INSERT\s+INTO\s+"?customer_prices"?\s*\(([^)]*)\)/gi;
const RAW_UPDATE = /UPDATE\s+"?customer_prices"?\s+SET\s+([\s\S]*?)(?:WHERE|`|;)/gi;
const PRISMA_PRICE_CALL = /\.customerPrice\.(\w+)\(/g;
const UPSERT_CALL = /\bupsertCustomerPrice\(/g;
/** `productId` written as a property name (`productId: x`, shorthand), not read as a value. */
const PRODUCT_ID_FIELD = /(?<=[{,]\s*|^[ \t]*)productId\s*[:,}]/m;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : tsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** Text of the call arguments from the opening parenthesis at `open` to its closing one. */
function callArguments(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === '(' || char === '{' || char === '[') depth++;
    else if (char === ')' || char === '}' || char === ']') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/** Text of the call arguments after the parenthesis at `open`, without the nested relations. */
function topLevelArguments(source: string, open: number, maxDepth: number): string {
  let depth = 0;
  let kept = '';
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === '(' || char === '{' || char === '[') depth++;
    else if (char === ')' || char === '}' || char === ']') {
      depth--;
      if (depth === 0) break;
    }
    if (depth <= maxDepth) kept += char;
  }
  return kept;
}

/** Paths (with line) that write `product_id` to `customer_prices` or pass `productId` to its writer. */
function offenders(): string[] {
  const found: string[] = [];
  for (const root of SCANNED) {
    for (const file of tsFiles(join(ROOT, root))) {
      const path = relative(ROOT, file).split('\\').join('/');
      if (EXEMPT.has(path)) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(RAW_INSERT)) {
        if (/\bproduct_id\b/.test(match[1])) found.push(`${path}:${lineOf(source, match.index)}`);
      }
      for (const match of source.matchAll(RAW_UPDATE)) {
        if (/\bproduct_id\b/.test(match[1])) found.push(`${path}:${lineOf(source, match.index)}`);
      }
      for (const match of source.matchAll(PRISMA_PRICE_CALL)) {
        const open = match.index + match[0].length - 1;
        const maxDepth = match[1] === 'createMany' ? 4 : 3;
        if (PRODUCT_ID_FIELD.test(topLevelArguments(source, open, maxDepth))) {
          found.push(`${path}:${lineOf(source, match.index)}`);
        }
      }
      for (const match of source.matchAll(UPSERT_CALL)) {
        const open = match.index + match[0].length - 1;
        if (/\bproductId\b/.test(callArguments(source, open))) {
          found.push(`${path}:${lineOf(source, match.index)}`);
        }
      }
    }
  }
  return found;
}

describe('negotiated prices and the product column', () => {
  it('scan: no file of src or tests writes product_id to customer_prices or passes productId to upsertCustomerPrice (AC-5)', () => {
    expect(offenders()).toEqual([]);
  });
});
