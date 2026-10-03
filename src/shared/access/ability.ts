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
