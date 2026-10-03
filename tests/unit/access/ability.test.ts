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
          const attributes = Object.fromEntries(
            Object.entries(rule.conditions ?? { counter: false }).map(([key, value]) => [
              key,
              typeof value === 'object' && value !== null && '$in' in value
                ? (value.$in as unknown[])[0]
                : value,
            ]),
          );
          const target = subject(rule.subject, attributes);
          const expected = RULES.some(
            (candidate) =>
              candidate.action === rule.action &&
              candidate.subject === rule.subject &&
              (!field || !candidate.fields || candidate.fields.includes(field)) &&
              (!candidate.conditions ||
                Object.entries(candidate.conditions).every(([key, value]) =>
                  typeof value === 'object' && value !== null && '$in' in value
                    ? (value.$in as unknown[]).includes(attributes[key])
                    : attributes[key] === value,
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

describe('order and delivery rules', () => {
  const phoneTwoDays = { daysSinceSync: 2, online: false, onServer: false };
  const phoneFourDays = { daysSinceSync: 4, online: false, onServer: false };
  const phoneNow = { daysSinceSync: 0, online: false, onServer: false };
  const online = { daysSinceSync: 30, online: true, onServer: false };

  it.each([
    ['DRIVER', phoneTwoDays, 'depart', 'CONFIRMED', true],
    ['DRIVER', phoneFourDays, 'depart', 'CONFIRMED', false],
    ['DRIVER', phoneFourDays, 'deliver', 'IN_DELIVERY', true],
    ['DRIVER', phoneFourDays, 'fail_delivery', 'IN_DELIVERY', true],
    ['DRIVER', phoneNow, 'deliver', 'CONFIRMED', false],
    ['DRIVER', phoneNow, 'cancel', 'CONFIRMED', false],
    ['SELLER', phoneTwoDays, 'cancel', 'CONFIRMED', true],
    ['SELLER', phoneTwoDays, 'cancel', 'DELIVERED', false],
    ['SELLER', phoneTwoDays, 'deliver', 'CONFIRMED', true],
    ['SELLER', phoneTwoDays, 'accept', 'PENDING', true],
    ['SELLER', phoneTwoDays, 'accept', 'CONFIRMED', false],
  ] as const)(
    'answers the order-step example for %s %s in %s',
    (role, context, action, status, expected) => {
      expect(abilityFor(role, context).can(action, subject('Order', { status }))).toBe(expected);
    },
  );

  it('allows only an online manager to assign a delivery', () => {
    expect(abilityFor('MANAGER', online).can('assign', 'Delivery')).toBe(true);
    expect(abilityFor('SELLER', online).can('assign', 'Delivery')).toBe(false);
    expect(abilityFor('MANAGER', phoneNow).can('assign', 'Delivery')).toBe(false);
  });

  it('enforces writable fields and frozen terminal orders', () => {
    const seller = abilityFor('SELLER', phoneTwoDays);

    expect(seller.can('update', subject('Order', { status: 'DELIVERED' }), 'supplier_note')).toBe(true);
    expect(seller.can('update', subject('Order', { status: 'DELIVERED' }), 'status')).toBe(false);
    expect(seller.can('update', 'OrderLine', 'unit_price_applied')).toBe(true);
    expect(seller.can('update', 'OrderLine', 'quantity')).toBe(false);
  });

  it.each(['accept', 'refuse', 'cancel', 'create'])(
    'prevents a driver from performing %s on orders',
    (action) => {
      expect(
        abilityFor('DRIVER', phoneNow).can(action, subject('Order', { status: 'PENDING' })),
      ).toBe(false);
    },
  );

  it('prevents a driver from updating order lines', () => {
    expect(abilityFor('DRIVER', phoneNow).can('update', 'OrderLine', 'unit_price_applied')).toBe(
      false,
    );
  });
});

describe('money rules', () => {
  const phoneThirtyDays = { daysSinceSync: 30, online: false, onServer: false };
  const phoneNow = { daysSinceSync: 0, online: false, onServer: false };
  const online = { daysSinceSync: 30, online: true, onServer: false };

  it.each([
    ['DRIVER', phoneThirtyDays, 'create', 'PAYMENT', true],
    ['DRIVER', phoneThirtyDays, 'create', 'REFUND', false],
    ['DRIVER', phoneThirtyDays, 'create', 'CREDIT_NOTE', false],
    ['SELLER', phoneThirtyDays, 'create', 'PAYMENT', true],
    ['SELLER', phoneThirtyDays, 'create', 'REFUND', false],
    ['MANAGER', online, 'create', 'REFUND', true],
    ['MANAGER', phoneNow, 'create', 'REFUND', false],
    ['MANAGER', online, 'create', 'OPENING_BALANCE', true],
    ['OWNER', phoneThirtyDays, 'reverse', 'SALE', true],
    ['SELLER', online, 'reverse', 'PAYMENT', false],
  ] as const)(
    'answers the ledger example for %s %s on %s',
    (role, context, action, kind, expected) => {
      expect(abilityFor(role, context).can(action, subject('LedgerEntry', { kind }))).toBe(expected);
    },
  );

  it.each(['Expense', 'Handover'] as const)(
    'allows managers online and owners to create and cancel %s',
    (resource) => {
      for (const action of ['create', 'cancel']) {
        expect(abilityFor('MANAGER', online).can(action, resource)).toBe(true);
        expect(abilityFor('MANAGER', phoneNow).can(action, resource)).toBe(false);
        expect(abilityFor('OWNER', phoneNow).can(action, resource)).toBe(true);
        expect(abilityFor('SELLER', online).can(action, resource)).toBe(false);
        expect(abilityFor('DRIVER', online).can(action, resource)).toBe(false);
      }
    },
  );

  it('implements every money rule across all roles and contexts', () => {
    const roles = ['DRIVER', 'SELLER', 'MANAGER', 'OWNER'] as const;
    const contexts = [phoneNow, phoneThirtyDays, online, { ...phoneThirtyDays, onServer: true }];
    const moneyRules = RULES.filter((rule) =>
      ['LedgerEntry', 'Expense', 'Handover'].includes(rule.subject),
    );

    for (const role of roles) {
      for (const context of contexts) {
        const ability = abilityFor(role, context);
        for (const rule of moneyRules) {
          const kindCondition = rule.conditions?.kind;
          const kind =
            typeof kindCondition === 'object' && kindCondition !== null && '$in' in kindCondition
              ? (kindCondition.$in as string[])[0]
              : kindCondition;
          const target =
            rule.subject === 'LedgerEntry' ? subject('LedgerEntry', { kind }) : rule.subject;
          const expected = moneyRules.some((candidate) => {
            const candidateAvailable =
              candidate.where === 'ALWAYS' ||
              (candidate.where === 'ONLINE' && (role === 'OWNER' || context.online));
            const candidateKind = candidate.conditions?.kind;
            const kindMatches =
              candidate.subject !== 'LedgerEntry' ||
              candidateKind === kind ||
              (typeof candidateKind === 'object' &&
                candidateKind !== null &&
                '$in' in candidateKind &&
                (candidateKind.$in as unknown[]).includes(kind));
            return (
              candidate.action === rule.action &&
              candidate.subject === rule.subject &&
              atLeast(role, candidate.who) &&
              candidateAvailable &&
              kindMatches
            );
          });

          expect(ability.can(rule.action, target)).toBe(expected);
        }

        expect(ability.can('delete', 'LedgerEntry')).toBe(false);
        expect(ability.can('update', 'Expense')).toBe(false);
        expect(ability.can('read', 'Handover')).toBe(false);
      }
    }
  });

  it('requires a permitted kind for every ledger creation', () => {
    const ledgerCreateRules = RULES.filter(
      (rule) => rule.action === 'create' && rule.subject === 'LedgerEntry',
    );

    expect(ledgerCreateRules).not.toHaveLength(0);
    expect(ledgerCreateRules.every((rule) => rule.conditions?.kind !== undefined)).toBe(true);
    for (const [role, context] of [
      ['DRIVER', phoneNow],
      ['SELLER', online],
      ['MANAGER', online],
      ['OWNER', phoneNow],
    ] as const) {
      expect(
        abilityFor(role, context).can('create', subject('LedgerEntry', { kind: 'UNKNOWN' })),
      ).toBe(false);
    }
  });

  it.each(['DRIVER', 'SELLER'] as const)('denies forbidden money gestures to %s', (role) => {
    const ability = abilityFor(role, online);

    expect(ability.can('reverse', subject('LedgerEntry', { kind: 'PAYMENT' }))).toBe(false);
    for (const kind of ['REFUND', 'CREDIT_NOTE']) {
      expect(ability.can('create', subject('LedgerEntry', { kind }))).toBe(false);
    }
    for (const resource of ['Expense', 'Handover']) {
      expect(ability.can('create', resource)).toBe(false);
      expect(ability.can('cancel', resource)).toBe(false);
    }
  });
});

describe('team, subscription and organization rules', () => {
  const offline = { daysSinceSync: 0, online: false, onServer: false };
  const online = { daysSinceSync: 30, online: true, onServer: false };
  const serverOffline = { daysSinceSync: 30, online: false, onServer: true };
  const serverOnline = { daysSinceSync: 30, online: true, onServer: true };

  it.each([
    ['OWNER', online, 'manage', 'Collaboration', true],
    ['OWNER', offline, 'manage', 'Collaboration', false],
    ['MANAGER', online, 'manage', 'Collaboration', false],
    ['OWNER', offline, 'close', 'Organization', false],
    ['OWNER', online, 'close', 'Organization', true],
    ['MANAGER', online, 'invite_supplier', 'CustomerRelationship', true],
    ['MANAGER', offline, 'order_from_supplier', 'CustomerRelationship', false],
    ['SELLER', online, 'invite_supplier', 'CustomerRelationship', false],
  ] as const)(
    'answers the network-only example for %s %s on %s',
    (role, context, action, resource, expected) => {
      expect(abilityFor(role, context).can(action, resource)).toBe(expected);
    },
  );

  it('implements every new rule across every role and context and denies unlisted actions', () => {
    const roles = ['DRIVER', 'SELLER', 'MANAGER', 'OWNER'] as const;
    const contexts = [offline, online, serverOffline, serverOnline];
    const teamRules = RULES.filter((rule) =>
      [
        'manage:Collaboration',
        'manage:Subscription',
        'transfer_ownership:Organization',
        'close:Organization',
        'reopen:Organization',
        'order_from_supplier:CustomerRelationship',
        'invite_supplier:CustomerRelationship',
      ].includes(`${rule.action}:${rule.subject}`),
    );

    expect(teamRules).toHaveLength(7);
    for (const role of roles) {
      for (const context of contexts) {
        const ability = abilityFor(role, context);
        for (const rule of teamRules) {
          expect(ability.can(rule.action, rule.subject)).toBe(
            atLeast(role, rule.who) && context.online,
          );
        }

        expect(ability.can('delete', 'Organization')).toBe(false);
        expect(ability.can('disconnect_supplier', 'CustomerRelationship')).toBe(false);
      }
    }
  });

  it('prevents a manager from changing rights in every context', () => {
    for (const context of [offline, online, serverOffline, serverOnline]) {
      const ability = abilityFor('MANAGER', context);

      expect(ability.can('manage', 'Collaboration')).toBe(false);
      expect(ability.can('manage', 'Subscription')).toBe(false);
      expect(ability.can('close', 'Organization')).toBe(false);
      expect(ability.can('reopen', 'Organization')).toBe(false);
      expect(ability.can('transfer_ownership', 'Organization')).toBe(false);
    }
  });
});
