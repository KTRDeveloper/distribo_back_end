import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { newImageKey } from '../../../src/lib/image-keys.js';
import { getImageProcessor, getImageStorage } from '../../../src/modules/images/image.ports.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { uniquePhone } from '../../helpers/phone.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const storage = getImageStorage();
const urlOf = (organizationId: string, productId: string, variantId: string, position: number) =>
  `/api/v1/organizations/${organizationId}/products/${productId}/variants/${variantId}/photos/${position}`;

/** A PNG-shaped buffer (the fake processor reads the signature and the size). */
function png(): Buffer {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(800, 16);
  bytes.writeUInt32BE(600, 20);
  return bytes;
}

/** A JPEG-shaped buffer. */
function jpeg(): Buffer {
  const bytes = Buffer.alloc(32);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(bytes, 0);
  bytes.writeUInt32BE(800, 16);
  bytes.writeUInt32BE(600, 20);
  return bytes;
}

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

type Setup = {
  organizationId: string;
  productId: string;
  variantId: string;
  people: Record<string, string>;
};

/** A business with one ACTIVE collaborator per role, one product and one variant. */
async function business(
  roles: Array<'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER'> = ['MANAGER'],
  variantStatus: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
  imageKeys: string[] = []
): Promise<Setup> {
  const organization = await prisma.organization.create({
    data: { id: newId(), name: 'Photo Business', status: 'ACTIVE' },
  });
  const people: Record<string, string> = {};
  // The database requires exactly one ACTIVE OWNER in a business that has collaborators.
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
  const variant = await prisma.productVariant.create({
    data: {
      id: newId(),
      productId: product.id,
      organizationId: organization.id,
      name: 'Red',
      unit: 'u',
      price: 1000n,
      status: variantStatus,
      imageKeys,
    },
  });
  return {
    organizationId: organization.id,
    productId: product.id,
    variantId: variant.id,
    people,
  };
}

async function seedFile(): Promise<string> {
  const key = newImageKey('products');
  await storage.put(key, Buffer.from('old'));
  return key;
}

const storedKeys = async (id: string) =>
  (
    await prisma.productVariant.findUniqueOrThrow({
      where: { id },
      select: { imageKeys: true },
    })
  ).imageKeys;

const put = (
  personId: string,
  s: { organizationId: string; productId: string; variantId: string },
  position: number,
  body: Buffer,
  type = 'image/png'
) =>
  createAuthenticatedRequest(app, personId)
    .put(urlOf(s.organizationId, s.productId, s.variantId, position))
    .set('Content-Type', type)
    .send(body);

const urlsOf = (res: request.Response) => (res.body as { image_urls: string[] }).image_urls;
const keyOfUrl = (url: string) => new URL(url).pathname.replace(/^\/images\//, '');
const fileKeys = async () => (await storage.listFiles(null, 1000)).map((f) => f.key);

afterEach(async () => {
  vi.restoreAllMocks();
  for (const file of await storage.listFiles(null, 1000)) await storage.delete(file.key);
});

describe('IMG-010 variant photos', () => {
  it('AC-1 adds, replaces and removes a photo; both files are gone', async () => {
    const s = await business();

    const first = await put(s.people.MANAGER, s, 1, png());
    expect(first.status).toBe(200);
    expect(urlsOf(first)).toHaveLength(1);
    const firstKey = keyOfUrl(urlsOf(first)[0]);
    expect(firstKey).toMatch(/^products\/.+\.webp$/);

    const second = await put(s.people.MANAGER, s, 1, jpeg(), 'image/jpeg');
    expect(second.status).toBe(200);
    expect(urlsOf(second)).toHaveLength(1);
    const secondKey = keyOfUrl(urlsOf(second)[0]);
    expect(secondKey).not.toBe(firstKey);
    expect(await storage.get(firstKey)).toBeNull();
    expect(await storedKeys(s.variantId)).toEqual([secondKey]);

    const photoId = secondKey.replace(/^products\//, '').replace(/\.webp$/, '');
    const removed = await createAuthenticatedRequest(app, s.people.MANAGER).delete(
      `/api/v1/organizations/${s.organizationId}/products/${s.productId}/variants/${s.variantId}/photos/${photoId}`
    );
    expect(removed.status).toBe(200);
    expect(urlsOf(removed)).toHaveLength(0);
    expect(await storedKeys(s.variantId)).toEqual([]);
    expect(await fileKeys()).toEqual([]);
  });

  it('AC-2 answers 404 when the product in the path is not the variant product', async () => {
    const s = await business();
    const keyOld = await seedFile();
    await prisma.productVariant.update({
      where: { id: s.variantId },
      data: { imageKeys: [keyOld] },
    });
    const other = await prisma.product.create({
      data: { id: newId(), organizationId: s.organizationId, name: 'Other' },
    });

    const res = await put(s.people.MANAGER, { ...s, productId: other.id }, 1, png());
    expect(res.status).toBe(404);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    expect(await storedKeys(s.variantId)).toEqual([keyOld]);
    expect(await fileKeys()).toEqual([keyOld]);

    const removed = await createAuthenticatedRequest(app, s.people.MANAGER).delete(
      `/api/v1/organizations/${s.organizationId}/products/${other.id}/variants/${s.variantId}/photos/${newId()}`
    );
    expect(removed.status).toBe(404);
    expect(await storedKeys(s.variantId)).toEqual([keyOld]);
  });

  it('AC-3 lets a manager change the photo of an INACTIVE variant', async () => {
    const s = await business(['MANAGER'], 'INACTIVE');
    const res = await put(s.people.MANAGER, s, 1, png());
    expect(res.status).toBe(200);
    expect(await storedKeys(s.variantId)).toHaveLength(1);
  });

  it('AC-3 refuses a seller and a driver with 403, a stranger with 404', async () => {
    const s = await business(['MANAGER', 'SELLER', 'DRIVER']);
    for (const role of ['SELLER', 'DRIVER']) {
      const res = await put(s.people[role], s, 1, png());
      expect(res.status).toBe(403);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('FORBIDDEN');
    }
    const stranger = await person();
    const res = await put(stranger, s, 1, png());
    expect(res.status).toBe(404);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    expect(await storedKeys(s.variantId)).toEqual([]);
    expect(await fileKeys()).toEqual([]);
  });

  it('AB-1 answers 404 to a manager of A on a variant of B and leaves B unchanged', async () => {
    const a = await business();
    const keyB = await seedFile();
    const b = await business(['MANAGER'], 'ACTIVE', [keyB]);

    const viaB = await put(a.people.MANAGER, b, 1, png());
    expect(viaB.status).toBe(404);
    const viaA = await put(
      a.people.MANAGER,
      { ...a, productId: b.productId, variantId: b.variantId },
      1,
      png()
    );
    expect(viaA.status).toBe(404);
    expect(bodyOf<ErrorBody>(viaA).error.code).toBe('NOT_FOUND');

    expect(await storedKeys(b.variantId)).toEqual([keyB]);
    expect(await fileKeys()).toEqual([keyB]);
  });

  it('answers 403 to a seller with a 3 MB body, before storage and processor run', async () => {
    const s = await business(['MANAGER', 'SELLER']);
    const inspect = vi.spyOn(getImageProcessor(), 'inspect');
    const putFile = vi.spyOn(storage, 'put');

    const res = await put(s.people.SELLER, s, 1, Buffer.alloc(3 * 1024 * 1024, 1));

    expect(res.status).toBe(403);
    expect(inspect).not.toHaveBeenCalled();
    expect(putFile).not.toHaveBeenCalled();
  });

  it('removes the new file when the variant is not under the product of the path', async () => {
    const s = await business();
    const other = await prisma.product.create({
      data: { id: newId(), organizationId: s.organizationId, name: 'Other' },
    });
    const res = await put(s.people.MANAGER, { ...s, productId: other.id }, 1, png());
    expect(res.status).toBe(404);
    expect(await fileKeys()).toEqual([]);
  });
});
