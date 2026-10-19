import { describe, expect, it } from 'vitest';
import { abilityFor, RULES } from '../../../src/shared/access/ability.js';

const online = { daysSinceSync: 0, online: true, onServer: false };
const offline = { daysSinceSync: 0, online: false, onServer: false };
const serverOffline = { daysSinceSync: 0, online: false, onServer: true };
const contexts = { online, offline } as const;

describe('owner rules for the team and the contacts', () => {
  it.each([
    ['OWNER', 'online', 'create', 'Collaboration', true],
    ['OWNER', 'online', 'update', 'Collaboration', true],
    ['OWNER', 'online', 'create', 'OrganizationContact', true],
    ['OWNER', 'online', 'delete', 'OrganizationContact', true],
    ['OWNER', 'offline', 'create', 'OrganizationContact', false],
    ['OWNER', 'offline', 'update', 'Collaboration', false],
    ['MANAGER', 'online', 'update', 'Collaboration', false],
    ['MANAGER', 'online', 'create', 'OrganizationContact', false],
  ] as const)('answers %s %s %s %s with %s', (role, ctx, action, resource, expected) => {
    expect(abilityFor(role, contexts[ctx]).can(action, resource)).toBe(expected);
  });

  it('names the writable fields of a collaboration', () => {
    const owner = abilityFor('OWNER', online);

    expect(owner.can('update', 'Collaboration', 'role')).toBe(true);
    expect(owner.can('update', 'Collaboration', 'status')).toBe(true);
    expect(owner.can('update', 'Collaboration', 'amount_held')).toBe(false);
    expect(owner.can('create', 'Collaboration', 'role')).toBe(true);
    expect(owner.can('create', 'Collaboration', 'status')).toBe(false);
  });

  it('names the writable fields of a contact', () => {
    const owner = abilityFor('OWNER', online);

    for (const action of ['create', 'delete']) {
      for (const field of ['kind', 'slot', 'value']) {
        expect(owner.can(action, 'OrganizationContact', field)).toBe(true);
      }
      expect(owner.can(action, 'OrganizationContact', 'organization_id')).toBe(false);
    }
    expect(owner.can('update', 'OrganizationContact')).toBe(false);
  });

  it('leaves no manage on the team', () => {
    expect(RULES.some((r) => r.action === 'manage' && r.subject === 'Collaboration')).toBe(false);
    for (const role of ['DRIVER', 'SELLER', 'MANAGER', 'OWNER']) {
      for (const context of [online, offline, serverOffline, { ...online, onServer: true }]) {
        expect(abilityFor(role, context).can('manage', 'Collaboration')).toBe(false);
      }
    }
  });

  it.each([
    ['create', 'Collaboration'],
    ['update', 'Collaboration'],
    ['create', 'OrganizationContact'],
    ['delete', 'OrganizationContact'],
  ] as const)('refuses a manager to %s %s in every context (CWE-285)', (action, resource) => {
    for (const context of [online, offline, serverOffline, { ...online, onServer: true }]) {
      expect(abilityFor('MANAGER', context).can(action, resource)).toBe(false);
    }
  });
});
