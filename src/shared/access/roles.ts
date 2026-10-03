export const ROLES = ['DRIVER', 'SELLER', 'MANAGER', 'OWNER'] as const;

export type Role = (typeof ROLES)[number];

/** Returns whether both roles are known and the role meets the required rank. */
export function atLeast(role: string, min: string): boolean {
  const roleRank = ROLES.findIndex((candidate) => candidate === role);
  const minimumRank = ROLES.findIndex((candidate) => candidate === min);

  return roleRank >= 0 && minimumRank >= 0 && roleRank >= minimumRank;
}
