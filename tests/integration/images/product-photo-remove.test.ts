import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { newImageKey } from '../../../src/lib/image-keys.js';
import { getImageStorage } from '../../../src/modules/images/image.ports.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { uniquePhone } from '../../helpers/phone.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const storage = getImageStorage();
const urlOf = (organizationId: string, productId: string, photoId: string) =>
  `/api/v1/organizations/${organizationId}/products/${productId}/photos/${photoId}`;

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

/** A business with one ACTIVE collaborator per requested role and one product holding the keys. */
async function business(
  roles: Array<'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER'> = ['MANAGER'],
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  imageKeys: string[] = []
): Promise<{ organizationId: string; productId: string; people: Record<string, string> }> {
  const organization = await prisma.organization.create({
    data: { id: newId(), name: 'Photo Business', status },
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
      name: 'Riz',
      unit: 'u',
      price: 1000n,
      imageKeys,
    },
  });
  return { organizationId: organization.id, productId: product.id, people };
}

async function seedFile(): Promise<string> {
  const key = newImageKey('products');
  await storage.put(key, Buffer.from('old'));
  return key;
}

const photoIdOf = (key: string) => key.replace(/^products\//, '').replace(/\.webp$/, '');
const storedKeys = async (id: string) =>
  (await prisma.product.findUniqueOrThrow({ where: { id }, select: { imageKeys: true } }))
    .imageKeys;
const fileKeys = async () => (await storage.listFiles(null, 1000)).map((f) => f.key);
const del = (personId: string, organizationId: string, productId: string, photoId: string) =>
  createAuthenticatedRequest(app, personId).delete(urlOf(organizationId, productId, photoId));
const urlsOf = (res: request.Response) => (res.body as { image_urls: string[] }).image_urls;

afterEach(async () => {
  vi.restoreAllMocks();
  for (const file of await storage.listFiles(null, 1000)) await storage.delete(file.key);
});

describe('IMG-009 remove a product photo', () => {
  it('AC-1 removes the photo by its id, twice, and deletes its file', async () => {
    const keys = [await seedFile(), await seedFile()];
    const { organizationId, productId, people } = await business(['MANAGER'], 'ACTIVE', keys);

    const first = await del(people.MANAGER, organizationId, productId, photoIdOf(keys[0]));
    expect(first.status).toBe(200);
    expect(urlsOf(first)).toHaveLength(1);
    expect(urlsOf(first)[0]).toContain(keys[1]);

    const second = await del(people.MANAGER, organizationId, productId, photoIdOf(keys[0]));
    expect(second.status).toBe(200);
    expect(urlsOf(second)).toEqual(urlsOf(first));

    expect(await storedKeys(productId)).toEqual([keys[1]]);
    expect(await fileKeys()).toEqual([keys[1]]);
  });

  it('AC-1 lets the owner remove a photo, and removing the last leaves an empty list', async () => {
    const keys = [await seedFile()];
    const { organizationId, productId, people } = await business(['OWNER'], 'ACTIVE', keys);
    const res = await del(people.OWNER, organizationId, productId, photoIdOf(keys[0]));
    expect(res.status).toBe(200);
    expect(urlsOf(res)).toEqual([]);
    expect(await storedKeys(productId)).toEqual([]);
    expect(await fileKeys()).toEqual([]);
  });

  it('AC-2 changes nothing for an id the product does not hold', async () => {
    const keys = [await seedFile(), await seedFile()];
    const { organizationId, productId, people } = await business(['MANAGER'], 'ACTIVE', keys);
    const remove = vi.spyOn(storage, 'delete');

    const res = await del(people.MANAGER, organizationId, productId, randomUUID());

    expect(res.status).toBe(200);
    expect(urlsOf(res)).toHaveLength(2);
    expect(await storedKeys(productId)).toEqual(keys);
    expect(remove).not.toHaveBeenCalled();
    expect(await fileKeys()).toHaveLength(2);
  });

  it('AC-3 refuses a seller, a driver, a stranger, a missing product, a suspended business, a bad id', async () => {
    const keys = [await seedFile()];
    const { organizationId, productId, people } = await business(
      ['MANAGER', 'SELLER', 'DRIVER'],
      'ACTIVE',
      keys
    );
    const photoId = photoIdOf(keys[0]);

    for (const role of ['SELLER', 'DRIVER']) {
      const res = await del(people[role], organizationId, productId, photoId);
      expect(res.status).toBe(403);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('FORBIDDEN');
    }

    const stranger = await del(await person(), organizationId, productId, photoId);
    expect(stranger.status).toBe(404);
    expect(bodyOf<ErrorBody>(stranger).error.code).toBe('NOT_FOUND');

    const missing = await del(people.MANAGER, organizationId, newId(), photoId);
    expect(missing.status).toBe(404);
    expect(bodyOf<ErrorBody>(missing).error.code).toBe('NOT_FOUND');

    const anonymous = await request(app).delete(urlOf(organizationId, productId, photoId));
    expect(anonymous.status).toBe(401);

    for (const bad of ['abc', '1', 'products%2Fx.webp']) {
      const res = await del(people.MANAGER, organizationId, productId, bad);
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    }

    expect(await storedKeys(productId)).toEqual(keys);
    expect(await fileKeys()).toEqual(keys);

    const suspendedKey = await seedFile();
    const suspended = await business(['MANAGER'], 'SUSPENDED', [suspendedKey]);
    const suspendedRes = await del(
      suspended.people.MANAGER,
      suspended.organizationId,
      suspended.productId,
      photoIdOf(suspendedKey)
    );
    expect(suspendedRes.status).toBe(409);
    expect(bodyOf<ErrorBody>(suspendedRes).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    expect(await storedKeys(suspended.productId)).toEqual([suspendedKey]);
    expect(await fileKeys()).toHaveLength(2);
  });

  it('AB-1 answers 404 to a manager of A on a product of B and leaves B unchanged', async () => {
    const a = await business();
    const keyB = await seedFile();
    const b = await business(['MANAGER'], 'ACTIVE', [keyB]);

    const viaB = await del(a.people.MANAGER, b.organizationId, b.productId, photoIdOf(keyB));
    expect(viaB.status).toBe(404);
    const viaA = await del(a.people.MANAGER, a.organizationId, b.productId, photoIdOf(keyB));
    expect(viaA.status).toBe(404);
    expect(bodyOf<ErrorBody>(viaA).error.code).toBe('NOT_FOUND');

    expect(await storedKeys(b.productId)).toEqual([keyB]);
    expect(await fileKeys()).toEqual([keyB]);
  });
});
