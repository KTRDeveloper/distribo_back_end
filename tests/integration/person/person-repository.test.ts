import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup.js';
import { newId } from '../../../src/shared/ids.js';
import {
  bumpScopeVersion,
  findByActivePhone,
  findOrCreateByPhone,
  toPublicPerson,
} from '../../../src/modules/person/person.repository.js';

const testPhones = [
  '+237677123456',
  '+237699000111',
  '+237677123457',
  '+237677123458',
  '+237677123459',
] as const;

describe.sequential('person repository', () => {
  afterEach(async () => {
    await prisma.person.deleteMany({
      where: {
        OR: [
          { phoneNumber: { in: [...testPhones] } },
          { releasedPhoneNumber: { in: [...testPhones] } },
        ],
      },
    });
  });

  it('finds only a person whose phone number is active', async () => {
    const active = await prisma.person.create({
      data: { id: newId(), phoneNumber: testPhones[0] },
    });
    await prisma.person.create({
      data: {
        id: newId(),
        phoneNumber: null,
        releasedPhoneNumber: testPhones[1],
      },
    });

    await expect(findByActivePhone(testPhones[0])).resolves.toMatchObject({
      id: active.id,
    });
    await expect(findByActivePhone(testPhones[1])).resolves.toBeNull();
  });

  it('creates one guest and returns it on subsequent calls', async () => {
    const first = await findOrCreateByPhone(testPhones[2]);
    const second = await findOrCreateByPhone(testPhones[2]);

    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      registeredAt: null,
      fullName: null,
      passwordHash: null,
      scopeVersion: 0,
    });
    await expect(prisma.person.count({ where: { phoneNumber: testPhones[2] } })).resolves.toBe(1);
  });

  it('creates one guest under concurrent calls', async () => {
    const people = await Promise.all(
      Array.from({ length: 5 }, () => findOrCreateByPhone(testPhones[3]))
    );

    expect(new Set(people.map(({ id }) => id))).toEqual(new Set([people[0].id]));
    await expect(prisma.person.count({ where: { phoneNumber: testPhones[3] } })).resolves.toBe(1);
  });

  it('returns an explicit three-field public view without private values', async () => {
    const guest = await findOrCreateByPhone(testPhones[4]);
    const privateValues = {
      email: 'private@example.test',
      language: 'fr',
      passwordHash: 'private-password-hash',
    };
    const registeredPerson = {
      ...guest,
      ...privateValues,
      fullName: 'Public Name',
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    const view = toPublicPerson(registeredPerson);

    expect(view).toEqual({
      public_name: 'Public Name',
      phone_number: testPhones[4],
      registered: true,
    });
    expect(Object.keys(view).sort()).toEqual(['phone_number', 'public_name', 'registered']);
    const serialized = JSON.stringify(view);
    for (const value of Object.values(privateValues)) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toContain(registeredPerson.registeredAt.toISOString());
  });

  it('hides a released number from the public view', async () => {
    const guest = await findOrCreateByPhone(testPhones[1]);

    expect(
      toPublicPerson({
        ...guest,
        phoneNumber: null,
        releasedPhoneNumber: testPhones[1],
      })
    ).toEqual({
      public_name: null,
      phone_number: null,
      registered: false,
    });
  });

  it('increments and returns the persisted scope version', async () => {
    const person = await findOrCreateByPhone(testPhones[0]);

    await expect(bumpScopeVersion(person.id)).resolves.toBe(1);
    await expect(bumpScopeVersion(person.id)).resolves.toBe(2);
    await expect(
      prisma.person.findUniqueOrThrow({ where: { id: person.id } })
    ).resolves.toMatchObject({ scopeVersion: 2 });
  });
});
