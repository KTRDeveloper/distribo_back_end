import { afterEach, describe, expect, it } from 'vitest';
import { abilityFor, RULES, type AccessRule } from '../../../src/shared/access/ability.js';
import { atLeast } from '../../../src/shared/access/roles.js';

const initialRules = [...RULES];

function useRule(rule: AccessRule): void {
  RULES.splice(0, RULES.length, rule);
}

afterEach(() => {
  RULES.splice(0, RULES.length, ...initialRules);
});

describe('role order', () => {
  it.each([
    ['DRIVER', 'DRIVER', true],
    ['SELLER', 'DRIVER', true],
    ['DRIVER', 'SELLER', false],
    ['OWNER', 'MANAGER', true],
    ['ADMIN', 'DRIVER', false],
    ['', 'DRIVER', false],
    ['OWNER', 'BOSS', false],
  ])('compares %s against minimum %s', (role, minimum, expected) => {
    expect(atLeast(role, minimum)).toBe(expected);
  });
});

describe('availability', () => {
  it.each([
    ['DAYS_3', 'SELLER', { daysSinceSync: 2, online: false, onServer: false }, true],
    ['DAYS_3', 'SELLER', { daysSinceSync: 3, online: false, onServer: false }, false],
    ['DAYS_3', 'SELLER', { daysSinceSync: 9, online: false, onServer: true }, true],
    ['DAYS_3', 'OWNER', { daysSinceSync: 9, online: false, onServer: false }, true],
    ['ONLINE', 'MANAGER', { daysSinceSync: 30, online: true, onServer: false }, true],
    ['ONLINE', 'MANAGER', { daysSinceSync: 30, online: false, onServer: false }, false],
    ['ONLINE', 'OWNER', { daysSinceSync: 30, online: false, onServer: false }, true],
    ['NETWORK', 'OWNER', { daysSinceSync: 30, online: false, onServer: false }, false],
    ['NETWORK', 'OWNER', { daysSinceSync: 30, online: true, onServer: false }, true],
    ['ALWAYS', 'DRIVER', { daysSinceSync: 30, online: false, onServer: false }, true],
  ] as const)('evaluates %s for %s', (where, role, context, expected) => {
    useRule({ who: role === 'DRIVER' ? 'DRIVER' : role === 'SELLER' ? 'SELLER' : 'MANAGER', where, action: 'create', subject: 'Example' });

    expect(abilityFor(role, context).can('create', 'Example')).toBe(expected);
  });
});

describe('deny by default', () => {
  it.each(['ADMIN', 'owner', ''])('allows nothing for forged role %j', (role) => {
    const ability = abilityFor(role, { daysSinceSync: 0, online: true, onServer: true });

    for (const action of ['create', 'read', 'update', 'delete', 'manage']) {
      expect(ability.can(action, 'CustomerRelationship')).toBe(false);
    }
  });
});
