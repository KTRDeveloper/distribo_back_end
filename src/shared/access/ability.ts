import { createMongoAbility, type MongoAbility, type RawRuleOf } from '@casl/ability';
import { atLeast, type Role } from './roles.js';

export type Where = 'ALWAYS' | 'DAYS_3' | 'ONLINE' | 'NETWORK';

export type AccessRule = {
  who: Role;
  where: Where;
  action: string;
  subject: string;
  fields?: string[];
  conditions?: Record<string, unknown>;
};

export type AccessContext = {
  daysSinceSync: number;
  online: boolean;
  onServer: boolean;
};

export const RULES: AccessRule[] = [
  {
    who: 'SELLER',
    where: 'DAYS_3',
    action: 'create',
    subject: 'CustomerRelationship',
  },
  {
    who: 'SELLER',
    where: 'DAYS_3',
    action: 'update',
    subject: 'CustomerRelationship',
    fields: ['customer_label', 'delivery_address', 'supplier_notes'],
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'update',
    subject: 'CustomerRelationship',
    fields: ['credit_limit'],
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'reassign',
    subject: 'CustomerRelationship',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'end',
    subject: 'CustomerRelationship',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'reopen',
    subject: 'CustomerRelationship',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'create',
    subject: 'CustomerRelationship',
    conditions: { counter: true },
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'create',
    subject: 'Product',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'update',
    subject: 'Product',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'create',
    subject: 'CustomerPrice',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'update',
    subject: 'CustomerPrice',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'delete',
    subject: 'CustomerPrice',
  },
  {
    who: 'DRIVER',
    where: 'DAYS_3',
    action: 'depart',
    subject: 'Order',
    conditions: { status: 'CONFIRMED' },
  },
  {
    who: 'DRIVER',
    where: 'ALWAYS',
    action: 'deliver',
    subject: 'Order',
    conditions: { status: 'IN_DELIVERY' },
  },
  {
    who: 'DRIVER',
    where: 'ALWAYS',
    action: 'fail_delivery',
    subject: 'Order',
    conditions: { status: 'IN_DELIVERY' },
  },
  {
    who: 'SELLER',
    where: 'DAYS_3',
    action: 'create',
    subject: 'Order',
  },
  {
    who: 'SELLER',
    where: 'DAYS_3',
    action: 'accept',
    subject: 'Order',
    conditions: { status: 'PENDING' },
  },
  {
    who: 'SELLER',
    where: 'DAYS_3',
    action: 'refuse',
    subject: 'Order',
    conditions: { status: 'PENDING' },
  },
  {
    who: 'SELLER',
    where: 'DAYS_3',
    action: 'cancel',
    subject: 'Order',
    conditions: { status: { $in: ['PENDING', 'CONFIRMED'] } },
  },
  {
    who: 'SELLER',
    where: 'DAYS_3',
    action: 'deliver',
    subject: 'Order',
    conditions: { status: 'CONFIRMED' },
  },
  {
    who: 'SELLER',
    where: 'DAYS_3',
    action: 'update',
    subject: 'Order',
    fields: ['supplier_note'],
  },
  {
    who: 'SELLER',
    where: 'DAYS_3',
    action: 'update',
    subject: 'OrderLine',
    fields: ['unit_price_applied'],
  },
  {
    who: 'MANAGER',
    where: 'ONLINE',
    action: 'assign',
    subject: 'Delivery',
  },
];

function isAvailable(where: Where, role: string, context: AccessContext): boolean {
  switch (where) {
    case 'ALWAYS':
      return true;
    case 'DAYS_3':
      return role === 'OWNER' || context.onServer || context.daysSinceSync < 3;
    case 'ONLINE':
      return role === 'OWNER' || context.online;
    case 'NETWORK':
      return context.online;
  }
}

/**
 * Builds a deny-by-default ability containing only rules available to the caller.
 * Filtering before CASL receives the rules prevents forged roles or unavailable
 * client contexts from influencing authorization decisions (ASVS 8.2.1/8.3.1).
 *
 * @param role - Untrusted role value from the caller's authenticated context.
 * @param context - Current connectivity and synchronization state.
 * @returns A CASL ability containing only authorized rules.
 */
export function abilityFor(role: string, context: AccessContext): MongoAbility {
  const rules: RawRuleOf<MongoAbility>[] = RULES.filter(
    ({ who, where }) => atLeast(role, who) && isAvailable(where, role, context),
  ).map(({ who: _who, where: _where, ...rule }) => rule);

  return createMongoAbility(rules);
}
