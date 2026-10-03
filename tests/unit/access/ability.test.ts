import { subject } from '@casl/ability';
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

describe('relationship, catalog and price rules', () => {
  const phoneTwoDays = { daysSinceSync: 2, online: false, onServer: false };
  const phoneFourDays = { daysSinceSync: 4, online: false, onServer: false };
  const phoneNow = { daysSinceSync: 0, online: false, onServer: false };
  const online = { daysSinceSync: 30, online: true, onServer: false };

  it.each([
    ['DRIVER', phoneNow, 'create', 'CustomerRelationship', undefined, false],
    ['SELLER', phoneTwoDays, 'create', 'CustomerRelationship', undefined, true],
    ['SELLER', phoneFourDays, 'create', 'CustomerRelationship', undefined, false],
    ['SELLER', phoneTwoDays, 'update', 'CustomerRelationship', 'customer_label', true],
    ['SELLER', phoneTwoDays, 'update', 'CustomerRelationship', 'credit_limit', false],
    ['MANAGER', online, 'update', 'CustomerRelationship', 'credit_limit', true],
    ['MANAGER', phoneNow, 'update', 'CustomerRelationship', 'credit_limit', false],
    ['OWNER', phoneNow, 'update', 'CustomerRelationship', 'credit_limit', true],
    ['MANAGER', phoneNow, 'create', 'Product', undefined, false],
    ['OWNER', phoneNow, 'create', 'Product', undefined, true],
    ['SELLER', online, 'create', 'CustomerPrice', undefined, false],
  ] as const)(
    'answers the examples for %s %s on %s',
    (role, context, action, resource, field, expected) => {
      expect(abilityFor(role, context).can(action, resource, field)).toBe(expected);
    },
  );

  const contexts = [
    ['phone 0 days', phoneNow],
    ['phone 4 days', phoneFourDays],
    ['online', online],
    ['server judging a sync', { daysSinceSync: 30, online: false, onServer: true }],
  ] as const;
  const roles = ['DRIVER', 'SELLER', 'MANAGER', 'OWNER'] as const;

  it('implements the complete who and where matrix and refuses unlisted actions', () => {
    for (const role of roles) {
      for (const [, context] of contexts) {
        const ability = abilityFor(role, context);
        const expectedRule = (rule: AccessRule): boolean => {
          const roleAllowed = atLeast(role, rule.who);
          const whereAllowed =
            rule.where === 'ALWAYS' ||
            (rule.where === 'DAYS_3' &&
              (role === 'OWNER' || context.onServer || context.daysSinceSync < 3)) ||
            (rule.where === 'ONLINE' && (role === 'OWNER' || context.online)) ||
            (rule.where === 'NETWORK' && context.online);
          return roleAllowed && whereAllowed;
        };

        for (const rule of RULES) {
          const field = rule.fields?.[0];
          const attributes = rule.conditions ?? { counter: false };
          const target = subject(rule.subject, { ...attributes });
          const expected = RULES.some(
            (candidate) =>
              candidate.action === rule.action &&
              candidate.subject === rule.subject &&
              (!field || !candidate.fields || candidate.fields.includes(field)) &&
              (!candidate.conditions ||
                Object.entries(candidate.conditions).every(
                  ([key, value]) => attributes[key] === value,
                )) &&
              expectedRule(candidate),
          );
          expect(ability.can(rule.action, target, field)).toBe(expected);
        }

        expect(ability.can('read', 'CustomerRelationship')).toBe(false);
        expect(ability.can('delete', 'Product')).toBe(false);
        expect(ability.can('read', 'CustomerPrice')).toBe(false);
      }
    }
  });

  it('requires the counter condition for a manager creating an extra counter', () => {
    const ability = abilityFor('MANAGER', online);

    expect(ability.can('create', subject('CustomerRelationship', { counter: true }))).toBe(true);
    expect(ability.can('create', subject('CustomerRelationship', { counter: false }))).toBe(false);
  });

  it('denies manager powers offline', () => {
    const ability = abilityFor('MANAGER', phoneNow);

    expect(ability.can('update', 'CustomerRelationship', 'credit_limit')).toBe(false);
    expect(ability.can('create', 'Product')).toBe(false);
    expect(ability.can('reassign', 'CustomerRelationship')).toBe(false);
  });
});
