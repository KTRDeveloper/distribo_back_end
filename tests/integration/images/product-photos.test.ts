import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { newImageKey } from '../../../src/lib/image-keys.js';
import { getImageProcessor, getImageStorage } from '../../../src/modules/images/image.ports.js';
import { setProductImageKeys } from '../../../src/modules/catalog/catalog.repository.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { uniquePhone } from '../../helpers/phone.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

// The real writer, wrapped so one test can make the database write fail.
vi.mock('../../../src/modules/catalog/catalog.repository.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../src/modules/catalog/catalog.repository.js')>();
  return { ...original, setProductImageKeys: vi.fn(original.setProductImageKeys) };
});

const storage = getImageStorage();
const urlOf = (organizationId: string, productId: string, position: number) =>
  `/api/v1/organizations/${organizationId}/products/${productId}/photos/${position}`;

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

/** A WebP-shaped buffer. */
function webp(): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.write('RIFF', 0, 'latin1');
  bytes.write('WEBP', 8, 'latin1');
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

/** A business with one ACTIVE collaborator per requested role and one product. */
async function business(
  roles: Array<'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER'> = ['MANAGER'],
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  imageKeys: string[] = []
): Promise<{ organizationId: string; productId: string; people: Record<string, string> }> {
  const organization = await prisma.organization.create({
    data: { id: newId(), name: 'Photo Business', status },
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
      name: 'Riz',
      unit: 'u',
      price: 1000n,
      imageKeys,
    },
  });
  return { organizationId: organization.id, productId: product.id, people };
}

/** Stores a file under a fresh products key and returns the key. */
async function seedFile(): Promise<string> {
  const key = newImageKey('products');
  await storage.put(key, Buffer.from('old'));
  return key;
}

const storedKeys = async (id: string) =>
  (await prisma.product.findUniqueOrThrow({ where: { id }, select: { imageKeys: true } }))
    .imageKeys;

const put = (
  personId: string,
  organizationId: string,
  productId: string,
  position: number,
  body: Buffer,
  type = 'image/png'
) =>
  createAuthenticatedRequest(app, personId)
    .put(urlOf(organizationId, productId, position))
    .set('Content-Type', type)
    .send(body);

const urlsOf = (res: request.Response) => (res.body as { image_urls: string[] }).image_urls;
const keyOfUrl = (url: string) => new URL(url).pathname.replace(/^\/images\//, '');
const fileKeys = async () => (await storage.listFiles(null, 1000)).map((f) => f.key);

afterEach(async () => {
  vi.mocked(setProductImageKeys).mockClear();
  vi.restoreAllMocks();
  for (const file of await storage.listFiles(null, 1000)) await storage.delete(file.key);
});

describe('IMG-008 product photo', () => {
  it('AC-1 adds two photos, replaces the first and removes its file', async () => {
    const { organizationId, productId, people } = await business();

    const first = await put(people.MANAGER, organizationId, productId, 1, png());
    expect(first.status).toBe(200);
    expect(urlsOf(first)).toHaveLength(1);
    const firstKey = keyOfUrl(urlsOf(first)[0]);
    expect(firstKey).toMatch(/^products\/.+\.webp$/);

    const second = await put(people.MANAGER, organizationId, productId, 2, jpeg(), 'image/jpeg');
    expect(second.status).toBe(200);
    expect(urlsOf(second)).toHaveLength(2);
    const secondKey = keyOfUrl(urlsOf(second)[1]);

    const third = await put(people.MANAGER, organizationId, productId, 1, webp(), 'image/webp');
    expect(third.status).toBe(200);
    expect(urlsOf(third)).toHaveLength(2);
    const thirdKey = keyOfUrl(urlsOf(third)[0]);

    expect(thirdKey).not.toBe(firstKey);
    expect(urlsOf(third)[1]).toBe(urlsOf(second)[1]);
    expect(await storedKeys(productId)).toEqual([thirdKey, secondKey]);
    expect(await storage.get(firstKey)).toBeNull();
    expect(await storage.get(secondKey)).not.toBeNull();
    expect(await storage.get(thirdKey)).not.toBeNull();
  });

  it('AC-1 lets the owner change a photo too', async () => {
    const { organizationId, productId, people } = await business(['OWNER']);
    const res = await put(people.OWNER, organizationId, productId, 1, png());
    expect(res.status).toBe(200);
  });

  it('AC-2 adds after the last photo, refuses a gap and position 0', async () => {
    const keys = [await seedFile(), await seedFile()];
    const { organizationId, productId, people } = await business(['MANAGER'], 'ACTIVE', keys);

    for (const position of [4, 0, 6, -1]) {
      const res = await put(people.MANAGER, organizationId, productId, position, png());
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    }
    const bad = await createAuthenticatedRequest(app, people.MANAGER)
      .put(`/api/v1/organizations/${organizationId}/products/${productId}/photos/abc`)
      .set('Content-Type', 'image/png')
      .send(png());
    expect(bad.status).toBe(400);
    expect(await storedKeys(productId)).toEqual(keys);
    expect(await fileKeys()).toHaveLength(2);

    const ok = await put(people.MANAGER, organizationId, productId, 3, png());
    expect(ok.status).toBe(200);
    expect(urlsOf(ok)).toHaveLength(3);
    expect(await storedKeys(productId)).toHaveLength(3);
  });

  it('AC-2 refuses a sixth photo', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 5; i++) keys.push(await seedFile());
    const { organizationId, productId, people } = await business(['MANAGER'], 'ACTIVE', keys);

    const res = await put(people.MANAGER, organizationId, productId, 6, png());
    expect(res.status).toBe(400);
    expect(await storedKeys(productId)).toEqual(keys);
    expect(await fileKeys()).toHaveLength(5);
  });

  it('AC-3 refuses a seller, a driver, a stranger, a suspended business, a missing product', async () => {
    const { organizationId, productId, people } = await business(['MANAGER', 'SELLER', 'DRIVER']);
    const oldKey = await seedFile();
    await prisma.product.update({ where: { id: productId }, data: { imageKeys: [oldKey] } });

    for (const role of ['SELLER', 'DRIVER']) {
      const res = await put(people[role], organizationId, productId, 1, png());
      expect(res.status).toBe(403);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('FORBIDDEN');
    }

    const stranger = await person();
    const strangerRes = await put(stranger, organizationId, productId, 1, png());
    expect(strangerRes.status).toBe(404);
    expect(bodyOf<ErrorBody>(strangerRes).error.code).toBe('NOT_FOUND');

    const missing = await put(people.MANAGER, organizationId, newId(), 1, png());
    expect(missing.status).toBe(404);
    expect(bodyOf<ErrorBody>(missing).error.code).toBe('NOT_FOUND');

    const anonymous = await request(app)
      .put(urlOf(organizationId, productId, 1))
      .set('Content-Type', 'image/png')
      .send(png());
    expect(anonymous.status).toBe(401);

    expect(await storedKeys(productId)).toEqual([oldKey]);
    expect(await fileKeys()).toEqual([oldKey]);

    const suspended = await business(['MANAGER'], 'SUSPENDED');
    const suspendedRes = await put(
      suspended.people.MANAGER,
      suspended.organizationId,
      suspended.productId,
      1,
      png()
    );
    expect(suspendedRes.status).toBe(409);
    expect(bodyOf<ErrorBody>(suspendedRes).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    expect(await storedKeys(suspended.productId)).toEqual([]);
    expect(await fileKeys()).toEqual([oldKey]);
  });

  it('AC-4 answers 500, keeps the list and removes the new file when the write fails', async () => {
    const { organizationId, productId, people } = await business();
    const oldKey = keyOfUrl(
      urlsOf(await put(people.MANAGER, organizationId, productId, 1, png()))[0]
    );
    vi.mocked(setProductImageKeys).mockRejectedValueOnce(new Error('database down'));

    const res = await put(people.MANAGER, organizationId, productId, 1, jpeg(), 'image/jpeg');

    expect(res.status).toBe(500);
    expect(await storedKeys(productId)).toEqual([oldKey]);
    expect(await fileKeys()).toEqual([oldKey]);
  });

  it('removes the new file when the position is refused after the product is locked', async () => {
    const { organizationId, productId, people } = await business();
    const res = await put(people.MANAGER, organizationId, productId, 2, png());
    expect(res.status).toBe(400);
    expect(await storedKeys(productId)).toEqual([]);
    expect(await fileKeys()).toEqual([]);
  });

  it('AB-1 answers 403 to a seller with a 3 MB body, before storage and processor run', async () => {
    const { organizationId, productId, people } = await business(['MANAGER', 'SELLER']);
    const inspect = vi.spyOn(getImageProcessor(), 'inspect');
    const reencode = vi.spyOn(getImageProcessor(), 'reencode');
    const putFile = vi.spyOn(storage, 'put');

    const res = await put(
      people.SELLER,
      organizationId,
      productId,
      1,
      Buffer.alloc(3 * 1024 * 1024, 1)
    );

    expect(res.status).toBe(403);
    expect(inspect).not.toHaveBeenCalled();
    expect(reencode).not.toHaveBeenCalled();
    expect(putFile).not.toHaveBeenCalled();
    expect(await storedKeys(productId)).toEqual([]);
  });

  it('AB-2 answers 404 to a manager of A on a product of B and leaves B unchanged', async () => {
    const a = await business();
    const keyB = await seedFile();
    const b = await business(['MANAGER'], 'ACTIVE', [keyB]);

    const viaB = await put(a.people.MANAGER, b.organizationId, b.productId, 1, png());
    expect(viaB.status).toBe(404);
    const viaA = await put(a.people.MANAGER, a.organizationId, b.productId, 1, png());
    expect(viaA.status).toBe(404);
    expect(bodyOf<ErrorBody>(viaA).error.code).toBe('NOT_FOUND');

    expect(await storedKeys(b.productId)).toEqual([keyB]);
    expect(await fileKeys()).toEqual([keyB]);
    expect(await storedKeys(a.productId)).toEqual([]);
  });

  it('AB-3 refuses a JSON body carrying a key and writes nothing', async () => {
    const { organizationId, productId, people } = await business();

    const res = await createAuthenticatedRequest(app, people.MANAGER)
      .put(urlOf(organizationId, productId, 1))
      .set('Content-Type', 'application/json')
      .send({ image_keys: ['products/x.webp'] });

    expect(res.status).toBe(400);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('UNSUPPORTED_IMAGE');
    expect(await storedKeys(productId)).toEqual([]);
    expect(await fileKeys()).toEqual([]);
  });
});
