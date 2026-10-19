/**
 * Unit tests for the variant label and the comparison text (CAT-016)
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { simplifyText, variantLabel } from '../../../src/shared/variant.js';

describe('variantLabel', () => {
  it.each([
    ['Riz', null, 'sac 50 kg', 'Riz — sac 50 kg'],
    ['T-shirt', 'Rouge/L', 'piece', 'T-shirt — Rouge/L (piece)'],
    ['Riz', '', 'sac 50 kg', 'Riz — sac 50 kg'],
  ])('AC-1: %s / %s / %s -> %s', (product, variant, unit, label) => {
    expect(variantLabel(product, variant, unit)).toBe(label);
  });

  it('changes nothing else: no trimming, no case change', () => {
    expect(variantLabel(' Riz ', ' Rouge ', ' KG ')).toBe(' Riz  —  Rouge  ( KG )');
  });
});

describe('simplifyText', () => {
  it.each([
    ['Sac 10 kg', 'sac 10 kg'],
    ['  sac   10 kg ', 'sac 10 kg'],
    ['sac 10kg', 'sac 10kg'],
    ['\tRiz\n\r', 'riz'],
    [null, ''],
    ['a ', 'a '],
  ])('AC-2: %j -> %j', (input, result) => {
    expect(simplifyText(input)).toBe(result);
  });

  it('keeps a non-breaking space at the ends (no trim())', () => {
    expect(simplifyText(' a ')).toBe(' a ');
  });
});

describe('AC-4: the file imports nothing', () => {
  it('has no import and no require', () => {
    const source = readFileSync(new URL('../../../src/shared/variant.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});

describe('AB-1: a huge name does not stall the server', () => {
  it('simplifies a million spaces and a letter in under one second', () => {
    const huge = ' '.repeat(1_000_000) + 'A';
    const started = performance.now();
    expect(simplifyText(huge)).toBe('a');
    expect(simplifyText('A' + ' '.repeat(1_000_000))).toBe('a');
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
