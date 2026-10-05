import { describe, expect, it } from 'vitest';
import { francs, whenWords } from '../../../src/modules/sync/sync.controls.js';

describe('words of the controls on arrival (SYNC-016)', () => {
  it('writes the day and hour of Douala, where 07:00 UTC is 8 h', () => {
    expect(whenWords(new Date('2026-09-28T07:00:00.000Z'))).toBe('lundi à 8 h');
    expect(whenWords(new Date('2026-09-28T07:05:00.000Z'))).toBe('lundi à 8 h 05');
    expect(whenWords(new Date('2026-09-27T23:30:00.000Z'))).toBe('lundi à 0 h 30');
  });

  it('groups the thousands of an amount in francs', () => {
    expect([0n, 950n, 3000n, 3200n, 1_250_000n].map(francs)).toEqual([
      '0',
      '950',
      '3 000',
      '3 200',
      '1 250 000',
    ]);
  });
});
