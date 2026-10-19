import { afterEach, describe, expect, it } from 'vitest';
import {
  abilityFor,
  RULES,
  type AccessContext,
  type AccessRule,
  type Where,
} from '../../../src/shared/access/ability.js';
import type { Role } from '../../../src/shared/access/roles.js';

const initialRules = [...RULES];

function useRule(rule: AccessRule): void {
  RULES.splice(0, RULES.length, rule);
}

afterEach(() => {
  RULES.splice(0, RULES.length, ...initialRules);
});

const online: AccessContext = { daysSinceSync: 30, online: true, onServer: false };
const offline: AccessContext = { daysSinceSync: 30, online: false, onServer: false };

describe('renamed availability values (AC-1)', () => {
  it.each([
    ['ONLINE_EXCEPT_OWNER', 'MANAGER', online, true],
    ['ONLINE_EXCEPT_OWNER', 'MANAGER', offline, false],
    ['ONLINE_EXCEPT_OWNER', 'OWNER', offline, true],
    ['ONLINE_FOR_ALL', 'OWNER', offline, false],
    ['ONLINE_FOR_ALL', 'OWNER', online, true],
  ] as const)('where %s, role %s: %#', (where, role, context, expected) => {
    useRule({ who: 'MANAGER', where, action: 'create', subject: 'Example' });

    expect(abilityFor(role, context).can('create', 'Example')).toBe(expected);
  });
});

describe('old names are gone (AC-2)', () => {
  it('gives every rule one of the four new values', () => {
    const allowed: Where[] = ['ALWAYS', 'DAYS_3', 'ONLINE_EXCEPT_OWNER', 'ONLINE_FOR_ALL'];

    expect(RULES.length).toBeGreaterThan(0);
    for (const rule of RULES) {
      expect(allowed).toContain(rule.where);
      expect(['ONLINE', 'NETWORK']).not.toContain(rule.where);
    }
  });
});

describe('the server judges a synchronization as offline (AC-3)', () => {
  const sync: AccessContext = { daysSinceSync: 9, online: false, onServer: true };

  it.each([
    ['ONLINE_EXCEPT_OWNER', 'MANAGER', 'OWNER', true],
    ['ONLINE_EXCEPT_OWNER', 'MANAGER', 'MANAGER', false],
    ['ONLINE_FOR_ALL', 'MANAGER', 'OWNER', false],
    ['DAYS_3', 'SELLER', 'SELLER', true],
  ] as const satisfies readonly (readonly [Where, Role, Role, boolean])[])(
    'where %s, minimum %s, role %s: %#',
    (where, min, role, expected) => {
      useRule({ who: min, where, action: 'create', subject: 'Example' });

      expect(abilityFor(role, sync).can('create', 'Example')).toBe(expected);
    }
  );
});

describe('an unknown availability value grants nothing (AB-1, CWE-285)', () => {
  it.each(['ONLINE', 'NETWORK', 'ANYWHERE', ''])(
    'refuses where %j even for the OWNER online',
    (where) => {
      useRule({ who: 'DRIVER', where: where as Where, action: 'create', subject: 'Example' });

      expect(abilityFor('OWNER', online).can('create', 'Example')).toBe(false);
    }
  );
});
