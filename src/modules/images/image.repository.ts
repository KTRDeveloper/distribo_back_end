import { prisma } from '../../lib/db.js';

/**
 * Of the given keys, those a card still holds: `people.avatar_key`, `organizations.logo_key`,
 * `products.image_keys` or `product_variants.image_keys` (C-49). Deleted cards count while
 * they still hold the key.
 */
export async function findCitedKeys(keys: string[]): Promise<Set<string>> {
  const cited = new Set<string>();
  if (keys.length === 0) return cited;

  const [people, organizations, products, variants] = await Promise.all([
    prisma.person.findMany({ where: { avatarKey: { in: keys } }, select: { avatarKey: true } }),
    prisma.organization.findMany({ where: { logoKey: { in: keys } }, select: { logoKey: true } }),
    prisma.product.findMany({
      where: { imageKeys: { hasSome: keys } },
      select: { imageKeys: true },
    }),
    prisma.productVariant.findMany({
      where: { imageKeys: { hasSome: keys } },
      select: { imageKeys: true },
    }),
  ]);

  const wanted = new Set(keys);
  const add = (key: string | null) => {
    if (key !== null && wanted.has(key)) cited.add(key);
  };
  people.forEach((row) => add(row.avatarKey));
  organizations.forEach((row) => add(row.logoKey));
  products.forEach((row) => row.imageKeys.forEach(add));
  variants.forEach((row) => row.imageKeys.forEach(add));
  return cited;
}
