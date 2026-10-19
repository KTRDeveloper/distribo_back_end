import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup.js';
import { newId } from '../../../src/shared/ids.js';
import { newImageKey } from '../../../src/lib/image-keys.js';
import {
  findOrCreateByPhone,
  toPublicPerson,
} from '../../../src/modules/person/person.repository.js';

const phones = ['+237677310001', '+237677310002', '+237677310003'] as const;
const BASE = process.env.IMAGE_PUBLIC_BASE_URL;

describe.sequential('public person view carries the photo address', () => {
  afterEach(async () => {
    await prisma.person.deleteMany({
      where: {
        OR: [{ phoneNumber: { in: [...phones] } }, { releasedPhoneNumber: { in: [...phones] } }],
      },
    });
  });

  it('AC-1 returns exactly four keys with the address built from the key', async () => {
    const key = newImageKey('avatars');
    const guest = await findOrCreateByPhone(phones[0]);

    const view = toPublicPerson({
      ...guest,
      fullName: 'Public Name',
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      avatarKey: key,
    });

    expect(Object.keys(view).sort()).toEqual([
      'avatar_url',
      'phone_number',
      'public_name',
      'registered',
    ]);
    expect(view.avatar_url).toBe(`${BASE}/${key}`);
  });

  it('AC-2 has a null address without a key, for a guest and for a released number', async () => {
    const guest = await findOrCreateByPhone(phones[1]);
    const registered = { ...guest, fullName: 'No Photo', registeredAt: new Date() };

    expect(toPublicPerson({ ...registered, avatarKey: null }).avatar_url).toBeNull();
    expect(toPublicPerson(guest).avatar_url).toBeNull();
    expect(
      toPublicPerson({ ...registered, phoneNumber: null, releasedPhoneNumber: phones[1] })
        .avatar_url
    ).toBeNull();
  });

  it('AB-1 leaks no private value and no raw key', async () => {
    const key = newImageKey('avatars');
    const guest = await findOrCreateByPhone(phones[2]);
    const privateValues = {
      email: 'private@example.test',
      language: 'fr',
      passwordHash: 'private-password-hash',
    };
    const registeredAt = new Date('2026-01-01T00:00:00.000Z');

    const serialized = JSON.stringify(
      toPublicPerson({
        ...guest,
        ...privateValues,
        id: newId(),
        fullName: 'Public Name',
        registeredAt,
        avatarKey: key,
      })
    );

    for (const value of Object.values(privateValues)) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toContain(registeredAt.toISOString());
    expect(serialized).not.toContain('avatar_key');
    expect(serialized.split(key)).toHaveLength(2);
    expect(serialized).toContain(`${BASE}/${key}`);
  });
});
