import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number) => {
    const c = store.get(key) ?? 0;
    if (c >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, c + 1);
    return Promise.resolve({ allowed: true, remaining: limit - c - 1 });
  },
  getCount: (key: string) => Promise.resolve(store.get(key) ?? 0),
  resetKey: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));
// The real session service, wrapped so one test can make a late step of the anonymization fail.
vi.mock('../../../src/modules/auth/session.service.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../src/modules/auth/session.service.js')>();
  return { ...original, revokeSessions: vi.fn(original.revokeSessions) };
});

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { hashPassword } = await import('../../../src/lib/password.js');
const { newImageKey } = await import('../../../src/lib/image-keys.js');
const { getImageStorage } = await import('../../../src/modules/images/image.ports.js');
const { revokeSessions } = await import('../../../src/modules/auth/session.service.js');
const { createAuthenticatedRequest } = await import('../../helpers/request.js');

const URL = '/api/v1/users/me';
const PASSWORD = 'correct-horse-battery-staple';
const REG = new Date('2026-01-01T00:00:00.000Z');
const storage = getImageStorage();

let passwordHash = '';
let personId = '';
let phoneSeq = 0;

/** A registered person, with a photo key and its file in storage when `withPhoto` is set. */
async function seedPerson(withPhoto: boolean): Promise<{ id: string; key: string | null }> {
  const id = newId();
  const key = withPhoto ? newImageKey('avatars') : null;
  phoneSeq += 1;
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: `+23767714${String(phoneSeq).padStart(4, '0')}`,
      phoneVerifiedAt: REG,
      preferredLanguage: 'FR',
      passwordHash,
      registeredAt: REG,
      avatarKey: key,
    },
  });
  if (key) await storage.put(key, Buffer.from('photo-bytes'));
  return { id, key };
}

const del = (id = personId) =>
  createAuthenticatedRequest(app, id).delete(URL).send({ password: PASSWORD });
const keyOf = async (id: string) =>
  (await prisma.person.findUniqueOrThrow({ where: { id }, select: { avatarKey: true } })).avatarKey;

beforeEach(async () => {
  store.clear();
  passwordHash = passwordHash || (await hashPassword(PASSWORD));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(revokeSessions).mockClear();
  for (const file of await storage.listFiles(null, 1000)) await storage.delete(file.key);
});

describe('PRIV-004 account deletion and the profile photo', () => {
  it('AC-1: the key is cleared and the file is gone from storage', async () => {
    const { id, key } = await seedPerson(true);
    personId = id;

    const res = await del();

    expect(res.status).toBe(204);
    const row = await prisma.person.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('ANONYMIZED');
    expect(row.avatarKey).toBeNull();
    expect(await storage.get(key!)).toBeNull();
  });

  it('AC-2: without a photo the answer is 204 and storage is not called', async () => {
    const { id } = await seedPerson(false);
    personId = id;
    const spy = vi.spyOn(storage, 'delete');

    const res = await del();

    expect(res.status).toBe(204);
    expect(spy).not.toHaveBeenCalled();
  });

  it('AC-3: when a later step fails the person keeps the key and the file stays', async () => {
    const { id, key } = await seedPerson(true);
    personId = id;
    vi.mocked(revokeSessions).mockRejectedValueOnce(new Error('boom'));

    const res = await del();

    expect(res.status).toBe(500);
    expect(await keyOf(id)).toBe(key);
    expect(await storage.get(key!)).not.toBeNull();
    expect((await prisma.person.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
  });

  it('AC-4: a storage refusal does not undo the deletion', async () => {
    const { id } = await seedPerson(true);
    personId = id;
    vi.spyOn(storage, 'delete').mockRejectedValue(new Error('storage down'));

    const res = await del();

    expect(res.status).toBe(204);
    expect(await keyOf(id)).toBeNull();
    expect((await prisma.person.findUniqueOrThrow({ where: { id } })).status).toBe('ANONYMIZED');
  });

  it('AB-1: no card cites the key and the file is not in storage afterwards', async () => {
    const { id, key } = await seedPerson(true);
    personId = id;

    expect((await del()).status).toBe(204);

    expect(await prisma.person.count({ where: { avatarKey: key } })).toBe(0);
    expect((await storage.listFiles(null, 1000)).map((f) => f.key)).not.toContain(key);
  });

  it("AB-2: another person's key and file are unchanged", async () => {
    const mine = await seedPerson(true);
    const other = await seedPerson(true);
    personId = mine.id;

    expect((await del()).status).toBe(204);

    expect(await keyOf(other.id)).toBe(other.key);
    expect(await storage.get(other.key!)).not.toBeNull();
  });
});
