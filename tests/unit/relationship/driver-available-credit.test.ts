/**
 * Unit tests for the driver's available credit (REL-032)
 */

import { describe, it, expect } from 'vitest';
import {
  projectForDriver,
  type RelationshipRow,
} from '../../../src/modules/relationship/relationship.visibility.js';

function row(limit: number | null, balance: number): RelationshipRow {
  return {
    id: '0190a000-0000-7000-8000-000000000001',
    creditLimit: limit === null ? null : BigInt(limit),
    balance: BigInt(balance),
    customerLabel: 'Counter customer',
    customerPerson: null,
    customerOrganization: null,
  } as unknown as RelationshipRow;
}

describe('projectForDriver available credit', () => {
  describe('AC-1: the driver available credit', () => {
    it.each([
      [50000, 20000, 30000],
      [50000, 50000, 0],
      [50000, 80000, 0],
      [0, 15000, 0],
      [null, 15000, null],
    ])('limit %s, balance %s gives %s', (limit, balance, available) => {
      expect(projectForDriver(row(limit, balance)).available_credit).toBe(available);
    });
  });

  describe('AB-1: deducing the debt', () => {
    it('holds no negative number, no balance and no limit with limit 0 and balance 15000', () => {
      const view = projectForDriver(row(0, 15000));
      expect(Object.keys(view).sort()).toEqual(['available_credit', 'customer_name', 'id']);
      expect(view.available_credit).toBe(0);
      expect(JSON.stringify(view)).not.toMatch(/:-\d/);
      expect(JSON.stringify(view)).not.toContain('15000');
    });
  });
});
