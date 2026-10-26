import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';
import { logger } from '../../../src/lib/logger';
import { newImageKey } from '../../../src/lib/image-keys';
import { getImageStorage } from '../../../src/modules/images/image.ports';
import { findCitedKeys } from '../../../src/modules/images/image.repository';
import { deleteImageFiles } from '../../../src/modules/images/image.service';

const ORG_ID = '0199c007-0000-7000-8000-000000000001';
const PRODUCT_ID = '0199c007-0000-7000-8000-000000000011';
const PERSON_ID = '0199c007-0000-7000-8000-000000000031';

const storage = getImageStorage();

async function store(key: string): Promise<void> {
  await storage.put(key, Buffer.from('file'));
}

const exists = async (key: string) => (await storage.get(key)) !== null;

async function seedProduct(imageKeys: string[]): Promise<void> {
  await prisma.product.create({
    data: {
      id: PRODUCT_ID,
      organizationId: ORG_ID,
      name: 'Riz',
      imageKeys,
    },
  });
}

beforeEach(async () => {
  await prisma.organization.create({ data: { id: ORG_ID, name: 'Fixture Business' } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const file of await storage.listFiles(null, 1000)) await storage.delete(file.key);
});

describe('deleteImageFiles', () => {
  it('AC-1, C-50 deletes two uncited files', async () => {
    const a = newImageKey('products');
    const b = newImageKey('products');
    await store(a);
    await store(b);

    await deleteImageFiles([a, b]);

    expect(await exists(a)).toBe(false);
    expect(await exists(b)).toBe(false);
  });

  it('AC-2, C-49 keeps a file held by a product and deletes the other', async () => {
    const a = newImageKey('products');
    const b = newImageKey('products');
    await store(a);
    await store(b);
    await seedProduct([a]);

    await deleteImageFiles([a, b]);

    expect(await exists(a)).toBe(true);
    expect(await exists(b)).toBe(false);
  });

  it('AC-3 ignores an absent file and survives a storage error with one warning', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const absent = newImageKey('products');

    await expect(deleteImageFiles([absent])).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();

    const present = newImageKey('products');
    await store(present);
    vi.spyOn(storage, 'delete').mockRejectedValue(new Error('storage down'));
    await expect(deleteImageFiles([present])).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ event: 'image_delete_failed' });
  });

  it('AB-1, CWE-639 keeps the file of a product when a variant still cites it', async () => {
    const shared = newImageKey('products');
    await store(shared);
    await seedProduct([shared]);
    // A variant of the product holds the key too
    await prisma.productVariant.create({
      data: {
        id: PRODUCT_ID,
        productId: PRODUCT_ID,
        organizationId: ORG_ID,
        unit: 'u',
        price: 1000n,
        imageKeys: [shared],
      },
    });
    // The product lets go of the key; the variant still holds it
    await prisma.product.update({ where: { id: PRODUCT_ID }, data: { imageKeys: [] } });

    await deleteImageFiles([shared]);

    expect(await exists(shared)).toBe(true);
  });

  it('keeps a file cited by an avatar or a logo, and does not touch a malformed key', async () => {
    const avatar = newImageKey('avatars');
    const logo = newImageKey('logos');
    await store(avatar);
    await store(logo);
    await prisma.person.create({
      data: {
        id: PERSON_ID,
        fullName: 'Fixture Person',
        phoneNumber: '+2250700007031',
        phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
        registeredAt: new Date('2026-01-01T00:00:00.000Z'),
        preferredLanguage: 'FR',
        avatarKey: avatar,
      },
    });
    await prisma.organization.update({ where: { id: ORG_ID }, data: { logoKey: logo } });
    const evil = '../products/escape.webp';
    await store(evil);

    await deleteImageFiles([avatar, logo, evil]);

    expect(await exists(avatar)).toBe(true);
    expect(await exists(logo)).toBe(true);
    expect(await exists(evil)).toBe(true);
  });

  it('does nothing for an empty list', async () => {
    await expect(deleteImageFiles([])).resolves.toBeUndefined();
  });
});

describe('findCitedKeys', () => {
  it('returns only the keys held by a card', async () => {
    const held = newImageKey('products');
    const free = newImageKey('products');
    await seedProduct([held]);

    const cited = await findCitedKeys([held, free]);

    expect([...cited]).toEqual([held]);
    expect((await findCitedKeys([])).size).toBe(0);
  });
});
