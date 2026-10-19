import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { newImageKey } from '../../../src/lib/image-keys.js';
import { getImageStorage } from '../../../src/modules/images/image.ports.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { uniquePhone } from '../../helpers/phone.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';
import { setAvatarKey } from '../../../src/modules/person/person.repository.js';

// The real writer, wrapped so one test can make the database write fail.
vi.mock('../../../src/modules/person/person.repository.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../src/modules/person/person.repository.js')>();
  return { ...original, setAvatarKey: vi.fn(original.setAvatarKey) };
});

const storage = getImageStorage();
const URL_PATH = '/api/v1/users/me/avatar';

/** A PNG-shaped buffer: signature and IHDR with the size (the fake processor reads these). */
function png(width = 800, height = 600): Buffer {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
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

/** A GIF-shaped buffer. */
const gif = (): Buffer => Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(32)]);

async function person(registered = true): Promise<string> {
  const now = new Date();
  const created = await prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: uniquePhone(),
      ...(registered
        ? {
            fullName: 'Avatar Person',
            passwordHash: 'hash',
            phoneVerifiedAt: now,
            registeredAt: now,
          }
        : {}),
    },
  });
  return created.id;
}

const storedKey = async (id: string) =>
  (await prisma.person.findUniqueOrThrow({ where: { id }, select: { avatarKey: true } })).avatarKey;

const put = (id: string, body: Buffer, type = 'image/png') =>
  createAuthenticatedRequest(app, id).put(URL_PATH).set('Content-Type', type).send(body);

const keyOf = (res: request.Response) =>
  new URL((res.body as { avatar_url: string }).avatar_url).pathname.replace(/^\/images\//, '');

afterEach(async () => {
  vi.mocked(setAvatarKey).mockClear();
  for (const file of await storage.listFiles(null, 1000)) await storage.delete(file.key);
});

describe('IMG-004 avatar', () => {
  it('AC-1 adds then replaces a photo and removes the first file', async () => {
    const id = await person();

    const first = await put(id, png());
    expect(first.status).toBe(200);
    const firstKey = keyOf(first);
    expect(firstKey).toMatch(/^avatars\/.+\.webp$/);
    expect((first.body as { avatar_url: string }).avatar_url.endsWith(firstKey)).toBe(true);
    expect(await storedKey(id)).toBe(firstKey);
    expect(await storage.get(firstKey)).not.toBeNull();

    const second = await put(id, jpeg(), 'image/jpeg');
    expect(second.status).toBe(200);
    const secondKey = keyOf(second);
    expect(secondKey).not.toBe(firstKey);
    expect(await storedKey(id)).toBe(secondKey);
    expect(await storage.get(firstKey)).toBeNull();
    expect(await storage.get(secondKey)).not.toBeNull();
  });

  it('AC-2 removes the photo, and a second DELETE also answers 204', async () => {
    const id = await person();
    const key = keyOf(await put(id, png()));

    const first = await createAuthenticatedRequest(app, id).delete(URL_PATH);
    expect(first.status).toBe(204);
    expect(await storedKey(id)).toBeNull();
    expect(await storage.get(key)).toBeNull();

    const second = await createAuthenticatedRequest(app, id).delete(URL_PATH);
    expect(second.status).toBe(204);
    expect(await storedKey(id)).toBeNull();
  });

  it('AC-3 refuses a guest, a GIF and a missing token, and changes nothing', async () => {
    const guest = await person(false);
    const guestRes = await put(guest, png());
    expect(guestRes.status).toBe(409);
    expect(bodyOf<ErrorBody>(guestRes).error.code).toBe('AVATAR_NOT_ALLOWED');
    expect(await storedKey(guest)).toBeNull();
    expect(await storage.listFiles(null, 1000)).toHaveLength(0);

    const id = await person();
    const gifRes = await put(id, gif(), 'image/png');
    expect(gifRes.status).toBe(400);
    expect(bodyOf<ErrorBody>(gifRes).error.code).toBe('UNSUPPORTED_IMAGE');
    expect(await storedKey(id)).toBeNull();

    const anonymous = await request(app).put(URL_PATH).set('Content-Type', 'image/png').send(png());
    expect(anonymous.status).toBe(401);
    expect(bodyOf<ErrorBody>(anonymous).error.code).toBe('UNAUTHORIZED');
    const anonymousDelete = await request(app).delete(URL_PATH);
    expect(anonymousDelete.status).toBe(401);
    expect(await storage.listFiles(null, 1000)).toHaveLength(0);
  });

  it('AC-4 answers 500, keeps the key and removes the new file when the write fails', async () => {
    const id = await person();
    const oldKey = keyOf(await put(id, png()));
    vi.mocked(setAvatarKey).mockRejectedValueOnce(new Error('database down'));

    const res = await put(id, jpeg(), 'image/jpeg');

    expect(res.status).toBe(500);
    expect(await storedKey(id)).toBe(oldKey);
    const files = (await storage.listFiles(null, 1000)).map((file) => file.key);
    expect(files).toEqual([oldKey]);
  });

  it('AB-1 changes only the session person when another person id is sent', async () => {
    const me = await person();
    const other = await person();
    const otherKey = newImageKey('avatars');
    await prisma.person.update({ where: { id: other }, data: { avatarKey: otherKey } });

    const res = await createAuthenticatedRequest(app, me)
      .put(`${URL_PATH}?person_id=${other}`)
      .set('Content-Type', 'image/png')
      .set('X-Person-Id', other)
      .send(png());

    expect(res.status).toBe(200);
    expect(await storedKey(me)).toBe(keyOf(res));
    expect(await storedKey(other)).toBe(otherKey);

    const del = await createAuthenticatedRequest(app, me).delete(`${URL_PATH}?person_id=${other}`);
    expect(del.status).toBe(204);
    expect(await storedKey(other)).toBe(otherKey);
  });

  it('AB-2 refuses a JSON body that carries a key and writes nothing', async () => {
    const id = await person();

    const res = await createAuthenticatedRequest(app, id)
      .put(URL_PATH)
      .set('Content-Type', 'application/json')
      .send({ avatar_key: 'avatars/x.webp' });

    expect(res.status).toBe(400);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('UNSUPPORTED_IMAGE');
    expect(await storedKey(id)).toBeNull();
  });
});
