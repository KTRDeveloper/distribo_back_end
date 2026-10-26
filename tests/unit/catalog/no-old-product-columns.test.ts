import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as catalogRepository from '../../../src/modules/catalog/catalog.repository';

const ROOT = join(__dirname, '../../..');
const SCANNED = ['src', 'tests'];
/** Files that name the dropped columns on purpose: this scan and the test of the drop. */
const EXEMPT = new Set([
  'tests/unit/catalog/no-old-product-columns.test.ts',
  'tests/integration/catalog/product-columns-dropped.test.ts',
]);

const OLD_FIELDS = /\b(unit|price|priceUpdatedAt|minOrderQuantity|status)\s*:/;
const OLD_COLUMNS = /\b(unit|price|price_updated_at|min_order_quantity|status)\b/;
const PRISMA_PRODUCT_CALL = /\.product\.(\w+)\(/g;
const PRODUCT_READ = /(?:const|let)\s+(\w+)\s*=\s*await\s+[\w.]+\.product\.find\w+\(/g;
const RAW_INSERT = /INSERT\s+INTO\s+"?products"?\s*\(([^)]*)\)/gi;
const RAW_UPDATE = /UPDATE\s+"?products"?\s+SET\s+([\s\S]*?)(?:WHERE|`|;)/gi;

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

/** Text of the call arguments after the opening parenthesis at `open`, without the nested relations. */
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
    // depth 1 is the argument object, 2 its `data`, `where` or `select`; deeper are relations.
    if (depth <= maxDepth) kept += char;
  }
  return kept;
}

/** Text from `start` to the end of the block that declares the variable there (a closing brace less indented). */
function enclosingBlock(source: string, start: number): string {
  const lineStart = source.lastIndexOf('\n', start) + 1;
  const indent = /^\s*/.exec(source.slice(lineStart))?.[0].length ?? 0;
  const closing = new RegExp(`\\n {0,${Math.max(indent - 1, 0)}}[})\\]]`);
  const rest = source.slice(start);
  const end = rest.search(closing);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Paths (with line) that insert old columns into `products` or use them on a Prisma `Product`. */
function offenders(): string[] {
  const found: string[] = [];
  for (const root of SCANNED) {
    for (const file of tsFiles(join(ROOT, root))) {
      const path = relative(ROOT, file).split('\\').join('/');
      if (EXEMPT.has(path)) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(RAW_INSERT)) {
        if (/\b(unit|price)\b/.test(match[1])) found.push(`${path}:${lineOf(source, match.index)}`);
      }
      for (const match of source.matchAll(RAW_UPDATE)) {
        if (OLD_COLUMNS.test(match[1])) found.push(`${path}:${lineOf(source, match.index)}`);
      }
      for (const match of source.matchAll(PRISMA_PRODUCT_CALL)) {
        const open = match.index + match[0].length - 1;
        // The rows of a `createMany` sit one level deeper, in the `data` array.
        const maxDepth = match[1] === 'createMany' ? 4 : 3;
        if (OLD_FIELDS.test(topLevelArguments(source, open, maxDepth))) {
          found.push(`${path}:${lineOf(source, match.index)}`);
        }
      }
      for (const match of source.matchAll(PRODUCT_READ)) {
        const field = new RegExp(`\\b${match[1]}\\.(unit|price|priceUpdatedAt|minOrderQuantity|status)\\b`);
        const used = field.exec(enclosingBlock(source, match.index));
        if (used) found.push(`${path}:${lineOf(source, match.index + used.index)}`);
      }
    }
  }
  return found;
}

describe('old product columns', () => {
  it('lookup: the catalog repository has no getActiveProduct (AC-4)', () => {
    expect(Object.keys(catalogRepository)).not.toContain('getActiveProduct');
  });

  it('scan: no file of src or tests uses the five dropped fields of a product (AC-5)', () => {
    expect(offenders()).toEqual([]);
  });
});
