/**
 * Unit tests for plan rank, calendar months, days and remaining-day conversion
 */

import { describe, it, expect } from 'vitest';
import {
  planRank,
  addMonths,
  addDays,
  convertRemainingDays,
  GRACE_DAYS,
} from '../../../src/modules/billing/plan-math.js';

const DAY = 86_400_000;

describe('Plan arithmetic', () => {
  it('AC-1 rank: four plans give 0 to 3', () => {
    expect(planRank('FREE')).toBe(0);
    expect(planRank('ESSENTIAL')).toBe(1);
    expect(planRank('PRO')).toBe(2);
    expect(planRank('ENTERPRISE')).toBe(3);
  });

  describe('AC-2 months', () => {
    it.each([
      ['2026-10-12T09:00:00Z', 3, '2027-01-12T09:00:00Z'],
      ['2026-11-30T09:00:00Z', 3, '2027-02-28T09:00:00Z'],
      ['2028-01-31T09:00:00Z', 1, '2028-02-29T09:00:00Z'],
      ['2026-03-31T09:00:00Z', 12, '2027-03-31T09:00:00Z'],
    ] as const)('%s + %i months = %s', (from, months, to) => {
      expect(addMonths(new Date(from), months).toISOString()).toBe(new Date(to).toISOString());
    });

    it('does not change the date it was given', () => {
      const from = new Date('2026-10-12T09:00:00Z');
      addMonths(from, 3);
      expect(from.toISOString()).toBe('2026-10-12T09:00:00.000Z');
    });
  });

  describe('AC-3 conversion', () => {
    it('20 days of ESSENTIAL to PRO = 10', () => {
      expect(convertRemainingDays([{ plan: 'ESSENTIAL', remainingMs: 20 * DAY }], 'PRO')).toBe(10);
    });
    it('20 and 31 days of ESSENTIAL to PRO = 26', () => {
      expect(
        convertRemainingDays(
          [
            { plan: 'ESSENTIAL', remainingMs: 20 * DAY },
            { plan: 'ESSENTIAL', remainingMs: 31 * DAY },
          ],
          'PRO',
        ),
      ).toBe(26);
    });
    it('20 days of PRO to ENTERPRISE = 8', () => {
      expect(convertRemainingDays([{ plan: 'PRO', remainingMs: 20 * DAY }], 'ENTERPRISE')).toBe(8);
    });
    it('1 ms of ESSENTIAL to PRO = 1', () => {
      expect(convertRemainingDays([{ plan: 'ESSENTIAL', remainingMs: 1 }], 'PRO')).toBe(1);
    });
    it('0 ms of ESSENTIAL to PRO = 0', () => {
      expect(convertRemainingDays([{ plan: 'ESSENTIAL', remainingMs: 0 }], 'PRO')).toBe(0);
    });
  });

  describe('AC-4 refused input', () => {
    it('a part of PRO to PRO', () => {
      expect(() => convertRemainingDays([{ plan: 'PRO', remainingMs: DAY }], 'PRO')).toThrow(
        RangeError,
      );
    });
    it('a part of ENTERPRISE to PRO', () => {
      expect(() => convertRemainingDays([{ plan: 'ENTERPRISE', remainingMs: DAY }], 'PRO')).toThrow(
        RangeError,
      );
    });
    it('a negative remainingMs', () => {
      expect(() => convertRemainingDays([{ plan: 'ESSENTIAL', remainingMs: -1 }], 'PRO')).toThrow(
        RangeError,
      );
    });
    it('a remainingMs that is not a finite integer', () => {
      for (const remainingMs of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
        expect(() => convertRemainingDays([{ plan: 'ESSENTIAL', remainingMs }], 'PRO')).toThrow(
          RangeError,
        );
      }
    });
    it('one bad part among good ones refuses the whole call', () => {
      expect(() =>
        convertRemainingDays(
          [
            { plan: 'ESSENTIAL', remainingMs: DAY },
            { plan: 'PRO', remainingMs: DAY },
          ],
          'PRO',
        ),
      ).toThrow(RangeError);
    });
  });

  it('AC-5 days: seven days added', () => {
    expect(GRACE_DAYS).toBe(7);
    expect(addDays(new Date('2026-10-12T09:00:00Z'), GRACE_DAYS).toISOString()).toBe(
      new Date('2026-10-19T09:00:00Z').toISOString(),
    );
  });
});
