import { createMongoAbility, type MongoAbility, type RawRuleOf } from '@casl/ability';
import { atLeast, type Role } from './roles.js';

/**
 * When a rule is available, named by whether the owner may still act offline:
 * - `ALWAYS`: any context.
 * - `DAYS_3`: the phone synchronized less than 3 days ago; the server (`onServer`) and the OWNER are not filtered.
 * - `ONLINE_EXCEPT_OWNER`: only online, but the OWNER may act offline too.
 * - `ONLINE_FOR_ALL`: only online, the OWNER included.
 */
export type Where = 'ALWAYS' | 'DAYS_3' | 'ONLINE_EXCEPT_OWNER' | 'ONLINE_FOR_ALL';

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
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'update',
    subject: 'CustomerRelationship',
    fields: ['credit_limit'],
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'reassign',
    subject: 'CustomerRelationship',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'end',
    subject: 'CustomerRelationship',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'reopen',
    subject: 'CustomerRelationship',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'create',
    subject: 'CustomerRelationship',
    conditions: { counter: true },
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'create',
    subject: 'Product',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'update',
    subject: 'Product',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'create',
    subject: 'CustomerPrice',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'update',
    subject: 'CustomerPrice',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
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
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'assign',
    subject: 'Delivery',
  },
  {
    who: 'DRIVER',
    where: 'ALWAYS',
    action: 'create',
    subject: 'LedgerEntry',
    conditions: { kind: { $in: ['SALE', 'PAYMENT'] } },
  },
  {
    who: 'SELLER',
    where: 'ALWAYS',
    action: 'create',
    subject: 'LedgerEntry',
    conditions: { kind: 'PAYMENT' },
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'create',
    subject: 'LedgerEntry',
    conditions: { kind: { $in: ['CREDIT_NOTE', 'REFUND', 'OPENING_BALANCE'] } },
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'reverse',
    subject: 'LedgerEntry',
    conditions: {
      kind: { $in: ['SALE', 'PAYMENT', 'CREDIT_NOTE', 'REFUND', 'OPENING_BALANCE'] },
    },
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'create',
    subject: 'Expense',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'cancel',
    subject: 'Expense',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'create',
    subject: 'Handover',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_EXCEPT_OWNER',
    action: 'cancel',
    subject: 'Handover',
  },
  {
    who: 'OWNER',
    where: 'ONLINE_FOR_ALL',
    action: 'manage',
    subject: 'Collaboration',
  },
  {
    who: 'OWNER',
    where: 'ONLINE_FOR_ALL',
    action: 'manage',
    subject: 'Subscription',
  },
  {
    who: 'OWNER',
    where: 'ONLINE_FOR_ALL',
    action: 'transfer_ownership',
    subject: 'Organization',
  },
  {
    who: 'OWNER',
    where: 'ONLINE_FOR_ALL',
    action: 'close',
    subject: 'Organization',
  },
  {
    who: 'OWNER',
    where: 'ONLINE_FOR_ALL',
    action: 'reopen',
    subject: 'Organization',
  },
  {
    who: 'OWNER',
    where: 'ONLINE_FOR_ALL',
    action: 'change_logo',
    subject: 'Organization',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_FOR_ALL',
    action: 'order_from_supplier',
    subject: 'CustomerRelationship',
  },
  {
    who: 'MANAGER',
    where: 'ONLINE_FOR_ALL',
    action: 'invite_supplier',
    subject: 'CustomerRelationship',
  },
];

/**
 * Tells whether a rule's availability holds in a context. A value it does not know (a rule built at
 * run time with a typo) is unavailable, so it never opens an action (ASVS v5.0.0-8.2.1).
 * The server judges a synchronization with `online: false`.
 */
function isAvailable(where: Where, role: string, context: AccessContext): boolean {
  switch (where) {
    case 'ALWAYS':
      return true;
    case 'DAYS_3':
      return role === 'OWNER' || context.onServer || context.daysSinceSync < 3;
    case 'ONLINE_EXCEPT_OWNER':
      return role === 'OWNER' || context.online;
    case 'ONLINE_FOR_ALL':
      return context.online;
    default:
      return false;
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
    ({ who, where }) => atLeast(role, who) && isAvailable(where, role, context)
  ).map(({ who: _who, where: _where, ...rule }) => rule);

  return createMongoAbility(rules);
}
