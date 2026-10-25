import { describe, expect, it } from 'vitest';
import { abilityFor, RULES } from '../../../src/shared/access/ability.js';

const online = { daysSinceSync: 0, online: true, onServer: false };
const offline = { daysSinceSync: 0, online: false, onServer: false };
const roles = ['DRIVER', 'SELLER', 'MANAGER', 'OWNER'] as const;

describe('subscription and keep rules', () => {
  it('AC-1 gives the subscription no rule for any role online', () => {
    for (const role of roles) {
      const ability = abilityFor(role, online);
      for (const action of ['manage', 'read', 'create', 'update']) {
        expect(ability.can(action, 'Subscription')).toBe(false);
      }
    }
  });

  it.each([
    ['OWNER', online, 'Collaboration', true],
    ['OWNER', online, 'Product', true],
    ['OWNER', offline, 'Product', false],
    ['MANAGER', online, 'Collaboration', false],
  ] as const)('AC-2 keep for %s: %j on %s is %s', (role, context, subject, expected) => {
    expect(abilityFor(role, context).can('keep', subject)).toBe(expected);
  });

  it('keep rows carry no field', () => {
    const keepRows = RULES.filter((rule) => rule.action === 'keep');

    expect(keepRows.map((rule) => rule.subject).sort()).toEqual(['Collaboration', 'Product']);
    for (const row of keepRows) {
      expect(row.fields).toBeUndefined();
      expect(row.who).toBe('OWNER');
      expect(row.where).toBe('ONLINE_FOR_ALL');
    }
  });

  it('AC-3 has no row with the action manage', () => {
    expect(RULES.filter((rule) => rule.action === 'manage')).toEqual([]);
  });

  it('AB-1 denies keep to a manager, seller and driver, online and offline', () => {
    for (const role of ['MANAGER', 'SELLER', 'DRIVER'] as const) {
      for (const context of [online, offline]) {
        const ability = abilityFor(role, context);

        expect(ability.can('keep', 'Collaboration')).toBe(false);
        expect(ability.can('keep', 'Product')).toBe(false);
      }
    }
  });
});
