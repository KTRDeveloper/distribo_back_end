import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { newImageKey } from '../../../src/lib/image-keys.js';
import { getImageProcessor, getImageStorage } from '../../../src/modules/images/image.ports.js';
import { setLogoKey } from '../../../src/modules/organization/organization.repository.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { uniquePhone } from '../../helpers/phone.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

// The real writer, wrapped so one test can make the database write fail.
vi.mock('../../../src/modules/organization/organization.repository.js', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('../../../src/modules/organization/organization.repository.js')
    >();
  return { ...original, setLogoKey: vi.fn(original.setLogoKey) };
});

const storage = getImageStorage();
const urlOf = (organizationId: string) => `/api/v1/organizations/${organizationId}/logo`;

/** A PNG-shaped buffer: signature and IHDR with the size (the fake processor reads these). */
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
      fullName: 'Logo Person',
      passwordHash: 'hash',
      phoneVerifiedAt: now,
      registeredAt: now,
    },
  });
  return created.id;
}

/** A business with one ACTIVE collaborator per requested role; returns their person ids. */
async function business(
  roles: Array<'OWNER' | 'MANAGER' | 'SELLER'> = ['OWNER'],
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE'
): Promise<{ organizationId: string; people: Record<string, string> }> {
  const organization = await prisma.organization.create({
    data: { id: newId(), name: 'Logo Business', status },
  });
  const people: Record<string, string> = {};
  for (const role of roles) {
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
  return { organizationId: organization.id, people };
}

const storedKey = async (id: string) =>
  (await prisma.organization.findUniqueOrThrow({ where: { id }, select: { logoKey: true } }))
    .logoKey;

const put = (personId: string, organizationId: string, body: Buffer, type = 'image/png') =>
  createAuthenticatedRequest(app, personId)
    .put(urlOf(organizationId))
    .set('Content-Type', type)
    .send(body);

const keyOf = (res: request.Response) =>
  new URL((res.body as { logo_url: string }).logo_url).pathname.replace(/^\/images\//, '');

afterEach(async () => {
  vi.mocked(setLogoKey).mockClear();
  vi.restoreAllMocks();
  for (const file of await storage.listFiles(null, 1000)) await storage.delete(file.key);
});

describe('IMG-005 business logo', () => {
  it('AC-1 adds then replaces the logo and removes the first file', async () => {
    const { organizationId, people } = await business();

    const first = await put(people.OWNER, organizationId, png());
    expect(first.status).toBe(200);
    const firstKey = keyOf(first);
    expect(firstKey).toMatch(/^logos\/.+\.webp$/);
    expect((first.body as { logo_url: string }).logo_url.endsWith(firstKey)).toBe(true);
    expect(await storedKey(organizationId)).toBe(firstKey);
    expect(await storage.get(firstKey)).not.toBeNull();

    const second = await put(people.OWNER, organizationId, jpeg(), 'image/jpeg');
    expect(second.status).toBe(200);
    const secondKey = keyOf(second);
    expect(secondKey).not.toBe(firstKey);
    expect(await storedKey(organizationId)).toBe(secondKey);
    expect(await storage.get(firstKey)).toBeNull();
    expect(await storage.get(secondKey)).not.toBeNull();
  });

  it('AC-2 removes the logo, and a second DELETE also answers 204', async () => {
    const { organizationId, people } = await business();
    const key = keyOf(await put(people.OWNER, organizationId, png()));

    const first = await createAuthenticatedRequest(app, people.OWNER).delete(urlOf(organizationId));
    expect(first.status).toBe(204);
    expect(await storedKey(organizationId)).toBeNull();
    expect(await storage.get(key)).toBeNull();

    const second = await createAuthenticatedRequest(app, people.OWNER).delete(
      urlOf(organizationId)
    );
    expect(second.status).toBe(204);
    expect(await storedKey(organizationId)).toBeNull();
  });

  it('AC-3 refuses a manager, a seller, a stranger, a suspended business and no token', async () => {
    const { organizationId, people } = await business(['OWNER', 'MANAGER', 'SELLER']);
    const oldKey = newImageKey('logos');
    await prisma.organization.update({ where: { id: organizationId }, data: { logoKey: oldKey } });
    await storage.put(oldKey, Buffer.from('old'));

    for (const role of ['MANAGER', 'SELLER']) {
      const res = await put(people[role], organizationId, png());
      expect(res.status).toBe(403);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('FORBIDDEN');
      const del = await createAuthenticatedRequest(app, people[role]).delete(urlOf(organizationId));
      expect(del.status).toBe(403);
    }

    const stranger = await person();
    const strangerRes = await put(stranger, organizationId, png());
    expect(strangerRes.status).toBe(404);
    expect(bodyOf<ErrorBody>(strangerRes).error.code).toBe('NOT_FOUND');

    const anonymous = await request(app)
      .put(urlOf(organizationId))
      .set('Content-Type', 'image/png')
      .send(png());
    expect(anonymous.status).toBe(401);
    expect(bodyOf<ErrorBody>(anonymous).error.code).toBe('UNAUTHORIZED');

    expect(await storedKey(organizationId)).toBe(oldKey);
    expect((await storage.listFiles(null, 1000)).map((f) => f.key)).toEqual([oldKey]);

    const suspended = await business(['OWNER'], 'SUSPENDED');
    const suspendedRes = await put(suspended.people.OWNER, suspended.organizationId, png());
    expect(suspendedRes.status).toBe(409);
    expect(bodyOf<ErrorBody>(suspendedRes).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    expect(await storedKey(suspended.organizationId)).toBeNull();
    expect((await storage.listFiles(null, 1000)).map((f) => f.key)).toEqual([oldKey]);
  });

  it('AC-4 answers 500, keeps the key and removes the new file when the write fails', async () => {
    const { organizationId, people } = await business();
    const oldKey = keyOf(await put(people.OWNER, organizationId, png()));
    vi.mocked(setLogoKey).mockRejectedValueOnce(new Error('database down'));

    const res = await put(people.OWNER, organizationId, jpeg(), 'image/jpeg');

    expect(res.status).toBe(500);
    expect(await storedKey(organizationId)).toBe(oldKey);
    const files = (await storage.listFiles(null, 1000)).map((file) => file.key);
    expect(files).toEqual([oldKey]);
  });

  it('AB-1 answers 403 to a manager with a 3 MB body, before storage and processor run', async () => {
    const { organizationId, people } = await business(['OWNER', 'MANAGER']);
    const inspect = vi.spyOn(getImageProcessor(), 'inspect');
    const reencode = vi.spyOn(getImageProcessor(), 'reencode');
    const putFile = vi.spyOn(storage, 'put');

    const res = await put(people.MANAGER, organizationId, Buffer.alloc(3 * 1024 * 1024, 1));

    expect(res.status).toBe(403);
    expect(inspect).not.toHaveBeenCalled();
    expect(reencode).not.toHaveBeenCalled();
    expect(putFile).not.toHaveBeenCalled();
    expect(await storedKey(organizationId)).toBeNull();
  });

  it('AB-2 answers 404 to the owner of A on the id of B and leaves the logo of B unchanged', async () => {
    const a = await business();
    const b = await business();
    const keyB = newImageKey('logos');
    await prisma.organization.update({ where: { id: b.organizationId }, data: { logoKey: keyB } });
    await storage.put(keyB, Buffer.from('b'));

    const res = await put(a.people.OWNER, b.organizationId, png());
    expect(res.status).toBe(404);
    const del = await createAuthenticatedRequest(app, a.people.OWNER).delete(
      urlOf(b.organizationId)
    );
    expect(del.status).toBe(404);

    expect(await storedKey(b.organizationId)).toBe(keyB);
    expect(await storage.get(keyB)).not.toBeNull();
    expect(await storedKey(a.organizationId)).toBeNull();
  });
});
