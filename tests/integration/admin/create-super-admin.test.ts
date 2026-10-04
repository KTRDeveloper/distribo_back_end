import { describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { createFirstSuperAdmin } from '../../../scripts/create-super-admin';
import { decryptSecret } from '../../../src/lib/totp';
import { newId } from '../../../src/shared/ids';
import { seedAccount } from '../../helpers/database';
import { uniquePhone } from '../../helpers/phone';

async function registeredPerson() {
  return seedAccount({
    email: `${newId()}@example.test`,
    password: 'fixture-password-1',
    name: 'Fixture Person',
  });
}

async function counts() {
  const [administrators, actions] = await Promise.all([
    prisma.administrator.count(),
    prisma.adminAction.count(),
  ]);
  return { administrators, actions };
}

function secretOf(uri: string): string {
  const secret = new URL(uri).searchParams.get('secret');
  if (!secret) throw new Error('no secret in URI');
  return secret;
}

describe('createFirstSuperAdmin', () => {
  it('first: creates a SUPER_ADMIN, its bootstrap journal row and returns the URI', async () => {
    const person = await registeredPerson();

    const result = await createFirstSuperAdmin(person.phoneNumber);

    expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const admin = await prisma.administrator.findUniqueOrThrow({
      where: { id: result.administratorId },
    });
    expect(admin.role).toBe('SUPER_ADMIN');
    expect(admin.personId).toBe(person.id);
    expect(admin.removedAt).toBeNull();
    expect(admin.totpSecret.length).toBeGreaterThan(0);

    const actions = await prisma.adminAction.findMany();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action: 'APPOINT_ADMIN',
      administratorId: result.administratorId,
      targetPersonId: person.id,
      reason: 'bootstrap',
    });
  });

  it.each([
    [
      'a guest',
      async () =>
        (
          await prisma.person.create({
            data: { id: newId(), phoneNumber: uniquePhone() },
          })
        ).phoneNumber,
    ],
    ['an unknown number', () => Promise.resolve(uniquePhone())],
    ['an invalid number', () => Promise.resolve('12345')],
  ])('refusals: %s throws and creates nothing', async (_label, makePhone) => {
    const phone = await makePhone();
    const peopleBefore = await prisma.person.count();

    await expect(createFirstSuperAdmin(phone)).rejects.toThrow();

    expect(await counts()).toEqual({ administrators: 0, actions: 0 });
    expect(await prisma.person.count()).toBe(peopleBefore);
  });

  it('refusals: a platform that already has a live SUPER_ADMIN', async () => {
    const first = await registeredPerson();
    await createFirstSuperAdmin(first.phoneNumber);
    const second = await registeredPerson();

    await expect(createFirstSuperAdmin(second.phoneNumber)).rejects.toThrow();

    expect(await counts()).toEqual({ administrators: 1, actions: 1 });
  });

  it('encrypted: the stored secret is not the printed one', async () => {
    const person = await registeredPerson();

    const { administratorId, otpauthUri } = await createFirstSuperAdmin(person.phoneNumber);

    const printed = secretOf(otpauthUri);
    const admin = await prisma.administrator.findUniqueOrThrow({ where: { id: administratorId } });
    expect(admin.totpSecret).not.toBe(printed);
    expect(admin.totpSecret).not.toContain(printed);
    expect(decryptSecret(admin.totpSecret)).toBe(printed);
  });

  it('second bootstrap: refused after the first administrator exists (CWE-269)', async () => {
    const person = await registeredPerson();
    await createFirstSuperAdmin(person.phoneNumber);

    await expect(createFirstSuperAdmin(person.phoneNumber)).rejects.toThrow();

    expect(await counts()).toEqual({ administrators: 1, actions: 1 });
  });

  it('a removed SUPER_ADMIN does not count: the platform can be bootstrapped again', async () => {
    const person = await registeredPerson();
    const first = await createFirstSuperAdmin(person.phoneNumber);
    await prisma.administrator.update({
      where: { id: first.administratorId },
      data: { removedAt: new Date() },
    });

    const second = await createFirstSuperAdmin(person.phoneNumber);

    expect(second.administratorId).not.toBe(first.administratorId);
  });

  it('concurrent runs: exactly one SUPER_ADMIN is created', async () => {
    const a = await registeredPerson();
    const b = await registeredPerson();

    const results = await Promise.allSettled([
      createFirstSuperAdmin(a.phoneNumber),
      createFirstSuperAdmin(b.phoneNumber),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.administrator.count()).toBe(1);
  });
});
