import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { newImageKey } from '../../../src/lib/image-keys.js';
import { getImageStorage } from '../../../src/modules/images/image.ports.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { uniquePhone } from '../../helpers/phone.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const storage = getImageStorage();

async function person(): Promise<string> {
  const now = new Date();
  const created = await prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: uniquePhone(),
      fullName: 'Photo Person',
      passwordHash: 'hash',
      phoneVerifiedAt: now,
      registeredAt: now,
    },
  });
  return created.id;
}

type Business = {
  organizationId: string;
  productId: string;
  people: Record<string, string>;
};

/** A business with one ACTIVE collaborator per role and one product. */
async function business(
  roles: Array<'MANAGER' | 'SELLER' | 'DRIVER'> = ['MANAGER']
): Promise<Business> {
  const organization = await prisma.organization.create({
    data: { id: newId(), name: 'Photo Business', status: 'ACTIVE' },
  });
  const people: Record<string, string> = {};
  for (const role of new Set(['OWNER' as const, ...roles])) {
    const personId = await person();
    await prisma.collaboration.create({
      data: {
        id: newId(),
        personId,
        organizationId: organization.id,
        role,
        status: 'ACTIVE',
        acceptedAt: new Date(),
      },
    });
    people[role] = personId;
  }
  const product = await prisma.product.create({
    data: {
      id: newId(),
      organizationId: organization.id,
      name: 'T-shirt',
    },
  });
  return { organizationId: organization.id, productId: product.id, people };
}

async function variant(
  b: { organizationId: string; productId: string },
  imageKeys: string[] = []
): Promise<string> {
  const created = await prisma.productVariant.create({
    data: {
      id: newId(),
      productId: b.productId,
      organizationId: b.organizationId,
      name: `Variant ${newId()}`,
      unit: 'u',
      price: 1000n,
      imageKeys,
    },
  });
  return created.id;
}

async function seedFile(): Promise<string> {
  const key = newImageKey('products');
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(bytes, 0);
  bytes.writeUInt32BE(40, 16);
  bytes.writeUInt32BE(30, 20);
  await storage.put(key, Buffer.concat([bytes, Buffer.from('pixels')]));
  return key;
}

const photoId = (key: string) => key.replace(/^products\//, '').replace(/\.webp$/, '');
const storedKeys = async (id: string) =>
  (await prisma.productVariant.findUniqueOrThrow({ where: { id }, select: { imageKeys: true } }))
    .imageKeys;
const keyOfUrl = (url: string) => new URL(url).pathname.replace(/^\/images\//, '');

const take = (
  personId: string,
  b: { organizationId: string; productId: string },
  destinationId: string,
  body: Record<string, unknown>
) =>
  createAuthenticatedRequest(app, personId)
    .post(
      `/api/v1/organizations/${b.organizationId}/products/${b.productId}/variants/${destinationId}/photos/copy`
    )
    .send(body);

afterEach(async () => {
  for (const file of await storage.listFiles(null, 1000)) await storage.delete(file.key);
});

describe('IMG-011 take a photo from another variant', () => {
  it('AC-1 take: new key on the destination, source unchanged, one registry row', async () => {
    const b = await business();
    const p = await seedFile();
    const a = await variant(b, [p]);
    const dest = await variant(b);

    const res = await take(b.people.MANAGER, b, dest, {
      id: newId(),
      source_variant_id: a,
      source_photo_id: photoId(p),
    });

    expect(res.status).toBe(201);
    const urls = (res.body as { image_urls: string[] }).image_urls;
    expect(urls).toHaveLength(1);
    const newKey = keyOfUrl(urls[0]);
    expect(newKey).not.toBe(p);
    expect(await storedKeys(dest)).toEqual([newKey]);
    expect(await storedKeys(a)).toEqual([p]);
    expect(await storage.get(p)).not.toBeNull();
    expect(await storage.get(newKey)).not.toBeNull();
    const rows = await prisma.imageCopy.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ copyKey: newKey, sourceKey: p, rootKey: p });
  });

  it('AC-2 repeat: the same body twice makes one copy and replays the answer', async () => {
    const b = await business();
    const p = await seedFile();
    const a = await variant(b, [p]);
    const dest = await variant(b);
    const body = { id: newId(), source_variant_id: a, source_photo_id: photoId(p) };

    const first = await take(b.people.MANAGER, b, dest, body);
    const second = await take(b.people.MANAGER, b, dest, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await storedKeys(dest)).toHaveLength(1);
    expect(await prisma.imageCopy.count()).toBe(1);
  });

  describe('AC-3 refusals', () => {
    it('a source variant of another product: 404', async () => {
      const b = await business();
      const p = await seedFile();
      const otherProduct = await prisma.product.create({
        data: { id: newId(), organizationId: b.organizationId, name: 'O' },
      });
      const src = await variant({ ...b, productId: otherProduct.id }, [p]);
      const dest = await variant(b);

      const res = await take(b.people.MANAGER, b, dest, {
        id: newId(),
        source_variant_id: src,
        source_photo_id: photoId(p),
      });

      expect(res.status).toBe(404);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
      expect(await storedKeys(dest)).toEqual([]);
      expect(await prisma.imageCopy.count()).toBe(0);
    });

    it('a photo id the source does not hold: 404', async () => {
      const b = await business();
      const p = await seedFile();
      const a = await variant(b, [p]);
      const dest = await variant(b);

      const res = await take(b.people.MANAGER, b, dest, {
        id: newId(),
        source_variant_id: a,
        source_photo_id: photoId(newImageKey('products')),
      });

      expect(res.status).toBe(404);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
      expect(await storedKeys(dest)).toEqual([]);
      expect(await prisma.imageCopy.count()).toBe(0);
    });

    it('a source file that is gone from storage: 404', async () => {
      const b = await business();
      const gone = newImageKey('products');
      const a = await variant(b, [gone]);
      const dest = await variant(b);

      const res = await take(b.people.MANAGER, b, dest, {
        id: newId(),
        source_variant_id: a,
        source_photo_id: photoId(gone),
      });

      expect(res.status).toBe(404);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
      expect(await storedKeys(dest)).toEqual([]);
      expect(await prisma.imageCopy.count()).toBe(0);
    });

    it('a destination that already holds 5 photos: 409 PHOTO_LIMIT_REACHED', async () => {
      const b = await business();
      const p = await seedFile();
      const a = await variant(b, [p]);
      const full = Array.from({ length: 5 }, () => newImageKey('products'));
      const dest = await variant(b, full);

      const res = await take(b.people.MANAGER, b, dest, {
        id: newId(),
        source_variant_id: a,
        source_photo_id: photoId(p),
      });

      expect(res.status).toBe(409);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('PHOTO_LIMIT_REACHED');
      expect(await storedKeys(dest)).toEqual(full);
      expect(await prisma.imageCopy.count()).toBe(0);
      expect(await storage.listFiles(null, 1000)).toHaveLength(1);
    });

    it('a destination holding 4 photos still takes a fifth', async () => {
      const b = await business();
      const p = await seedFile();
      const a = await variant(b, [p]);
      const four = Array.from({ length: 4 }, () => newImageKey('products'));
      const dest = await variant(b, four);

      const res = await take(b.people.MANAGER, b, dest, {
        id: newId(),
        source_variant_id: a,
        source_photo_id: photoId(p),
      });

      expect(res.status).toBe(201);
      expect(await storedKeys(dest)).toHaveLength(5);
    });

    it('the destination as its own source: 400 VALIDATION_ERROR', async () => {
      const b = await business();
      const p = await seedFile();
      const a = await variant(b, [p]);

      const res = await take(b.people.MANAGER, b, a, {
        id: newId(),
        source_variant_id: a,
        source_photo_id: photoId(p),
      });

      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
      expect(await storedKeys(a)).toEqual([p]);
      expect(await prisma.imageCopy.count()).toBe(0);
    });

    it('an unknown field in the body: 400 VALIDATION_ERROR', async () => {
      const b = await business();
      const p = await seedFile();
      const a = await variant(b, [p]);
      const dest = await variant(b);

      const res = await take(b.people.MANAGER, b, dest, {
        id: newId(),
        source_variant_id: a,
        source_photo_id: photoId(p),
        extra: 1,
      });

      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
      expect(await storedKeys(dest)).toEqual([]);
      expect(await prisma.imageCopy.count()).toBe(0);
    });

    it('a seller or a driver: 403 FORBIDDEN', async () => {
      const b = await business(['SELLER', 'DRIVER']);
      const p = await seedFile();
      const a = await variant(b, [p]);
      const dest = await variant(b);

      for (const role of ['SELLER', 'DRIVER']) {
        const res = await take(b.people[role], b, dest, {
          id: newId(),
          source_variant_id: a,
          source_photo_id: photoId(p),
        });
        expect(res.status).toBe(403);
        expect(bodyOf<ErrorBody>(res).error.code).toBe('FORBIDDEN');
      }
      expect(await storedKeys(dest)).toEqual([]);
      expect(await prisma.imageCopy.count()).toBe(0);
    });
  });

  it('AB-1 a variant of another business as the source: 404, nothing copied', async () => {
    const mine = await business();
    const theirs = await business();
    const p = await seedFile();
    const theirVariant = await variant(theirs, [p]);
    const dest = await variant(mine);

    const res = await take(mine.people.MANAGER, mine, dest, {
      id: newId(),
      source_variant_id: theirVariant,
      source_photo_id: photoId(p),
    });

    expect(res.status).toBe(404);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    expect(await storedKeys(dest)).toEqual([]);
    expect(await prisma.imageCopy.count()).toBe(0);
    expect(await storage.listFiles(null, 1000)).toHaveLength(1);
  });

  it('a copy of a copy keeps the root of the first photo (C-56)', async () => {
    const b = await business();
    const p = await seedFile();
    const a = await variant(b, [p]);
    const second = await variant(b);
    const third = await variant(b);

    const first = await take(b.people.MANAGER, b, second, {
      id: newId(),
      source_variant_id: a,
      source_photo_id: photoId(p),
    });
    const copyKey = keyOfUrl((first.body as { image_urls: string[] }).image_urls[0]);
    const again = await take(b.people.MANAGER, b, third, {
      id: newId(),
      source_variant_id: second,
      source_photo_id: photoId(copyKey),
    });

    expect(again.status).toBe(201);
    const newKey = keyOfUrl((again.body as { image_urls: string[] }).image_urls[0]);
    const row = await prisma.imageCopy.findUniqueOrThrow({ where: { copyKey: newKey } });
    expect(row.sourceKey).toBe(copyKey);
    expect(row.rootKey).toBe(p);
  });
});
