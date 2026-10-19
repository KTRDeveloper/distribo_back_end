import { describe, expect, it } from 'vitest';
import { prisma } from '../../setup.js';
import { newId } from '../../../src/shared/ids.js';
import { newImageKey } from '../../../src/lib/image-keys.js';
import { setAvatarKey } from '../../../src/modules/person/person.repository.js';
import { uniquePhone } from '../../helpers/phone.js';

async function registeredPerson(avatarKey: string | null = null): Promise<string> {
  const now = new Date();
  const person = await prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: uniquePhone(),
      fullName: 'Test Person',
      passwordHash: 'hash',
      phoneVerifiedAt: now,
      registeredAt: now,
      avatarKey,
    },
  });
  return person.id;
}

async function storedKey(id: string): Promise<string | null> {
  const person = await prisma.person.findUniqueOrThrow({
    where: { id },
    select: { avatarKey: true },
  });
  return person.avatarKey;
}

describe('setAvatarKey', () => {
  it('sets, replaces and clears the key, returning the previous one (AC-1)', async () => {
    const id = await registeredPerson();
    const keyA = newImageKey('avatars');
    const keyB = newImageKey('avatars');

    expect(await setAvatarKey(id, keyA)).toBeNull();
    expect(await storedKey(id)).toBe(keyA);

    expect(await setAvatarKey(id, keyB)).toBe(keyA);
    expect(await storedKey(id)).toBe(keyB);

    expect(await setAvatarKey(id, null)).toBe(keyB);
    expect(await storedKey(id)).toBeNull();
  });

  it('fails with 404 NOT_FOUND for an unknown person (AC-2)', async () => {
    await expect(setAvatarKey(newId(), newImageKey('avatars'))).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('rejects a key for a guest and leaves it empty (AC-3)', async () => {
    const guest = await prisma.person.create({
      data: { id: newId(), phoneNumber: uniquePhone() },
    });

    await expect(setAvatarKey(guest.id, newImageKey('avatars'))).rejects.toBeDefined();
    expect(await storedKey(guest.id)).toBeNull();
  });

  it('writes in the caller transaction, so a rollback restores the key (AC-4)', async () => {
    const keyA = newImageKey('avatars');
    const id = await registeredPerson(keyA);
    const rollback = new Error('rollback');

    await expect(
      prisma.$transaction(async (tx) => {
        expect(await setAvatarKey(id, newImageKey('avatars'), tx)).toBe(keyA);
        throw rollback;
      })
    ).rejects.toBe(rollback);

    expect(await storedKey(id)).toBe(keyA);
  });

  it('serializes two replacements at once (AC-5)', async () => {
    const keyA = newImageKey('avatars');
    const keyB = newImageKey('avatars');
    const keyC = newImageKey('avatars');
    const id = await registeredPerson(keyA);

    const [first, second] = await Promise.all([
      setAvatarKey(id, keyB),
      setAvatarKey(id, keyC),
    ]);

    const returned = [first, second];
    expect(returned).toContain(keyA);
    const other = returned.find((value) => value !== keyA);
    expect([keyB, keyC]).toContain(other);
    const lastWriter = other === keyB ? keyC : keyB;
    expect(await storedKey(id)).toBe(lastWriter);
  });

  it('throws a RangeError for a crafted key and writes nothing (AB-1)', async () => {
    const keyA = newImageKey('avatars');
    const id = await registeredPerson(keyA);
    const uuid = newImageKey('avatars').slice('avatars/'.length);
    const crafted = [
      newImageKey('products'),
      'avatars/../x.webp',
      `avatars/${uuid.toUpperCase().replace('.WEBP', '.webp')}`,
    ];

    for (const key of crafted) {
      await expect(setAvatarKey(id, key)).rejects.toBeInstanceOf(RangeError);
    }
    expect(await storedKey(id)).toBe(keyA);
  });
});
