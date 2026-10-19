import request from 'supertest';
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

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { hashPassword } = await import('../../../src/lib/password.js');
const { createAuthenticatedRequest } = await import('../../helpers/request.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const URL = '/api/v1/users/me';
const PHONE = '+237677130001';
const PASSWORD = 'correct-horse-battery-staple';
const REG = new Date('2026-01-01T00:00:00.000Z');
const SUPPLIER_OWNER = '0199c0a1-0000-7000-8000-000000000003';
const SUPPLIER_ORG = '0199c0a1-0000-7000-8000-0000000000a1';
const dev = {
  platform: 'ANDROID' as const,
  app_version: '1.0.0',
  push_token: 'fixture-push-token',
};

type ErrBody = {
  error?: { code: string; blockers?: Array<{ code: string; label: string }> };
};

let personId = '';
let passwordHash = '';

async function seedPerson(id: string, phone: string, hash: string) {
  return prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      email: `${id}@example.test`,
      emailVerifiedAt: REG,
      preferredLanguage: 'FR',
      passwordHash: hash,
      registeredAt: REG,
    },
  });
}

async function seedSupplierOrg() {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: SUPPLIER_ORG, name: 'Grossiste Mbarga' } });
    await tx.collaboration.create({
      data: {
        id: newId(),
        personId: SUPPLIER_OWNER,
        organizationId: SUPPLIER_ORG,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  });
}

// Raw SQL keeps these fixtures independent of the Task model; the column is account_id.
const seedTask = () =>
  prisma.$executeRaw`INSERT INTO tasks (id, type, account_id, parameters, "updatedAt")
    VALUES (${newId()}, 'export', ${personId}::uuid, '{}'::jsonb, now())`;
const taskCount = async () =>
  Number(
    (
      await prisma.$queryRaw<
        Array<{ n: bigint }>
      >`SELECT count(*) AS n FROM tasks WHERE account_id = ${personId}::uuid`
    )[0]?.n
  );

const del = (body?: object, id = personId) => {
  const r = createAuthenticatedRequest(app, id).delete(URL);
  return body === undefined ? r : r.send(body);
};
const person = () => prisma.person.findUniqueOrThrow({ where: { id: personId } });
const errOf = (r: { body: unknown }) => (r.body as ErrBody).error;

beforeEach(async () => {
  store.clear();
  passwordHash = passwordHash || (await hashPassword(PASSWORD));
  personId = newId();
  await seedPerson(personId, PHONE, passwordHash);
  await seedPerson(SUPPLIER_OWNER, '+237677130003', passwordHash);
  await seedSupplierOrg();
});

afterEach(async () => {
  await prisma.$executeRaw`DROP TRIGGER IF EXISTS fail_task_delete ON tasks`;
  await prisma.$executeRaw`DROP FUNCTION IF EXISTS fail_task_delete()`;
});

describe('DELETE /api/v1/users/me', () => {
  it('AC-1: anonymizes the person and answers 204', async () => {
    const before = await person();
    const res = await del({ password: PASSWORD });

    expect(res.status).toBe(204);
    const row = await person();
    expect(row).toMatchObject({
      fullName: null,
      email: null,
      emailVerifiedAt: null,
      preferredLanguage: null,
      passwordHash: null,
      phoneNumber: null,
      phoneVerifiedAt: null,
      releasedPhoneNumber: PHONE,
      status: 'ANONYMIZED',
    });
    expect(row.anonymizedAt).toBeInstanceOf(Date);
    expect(row.registeredAt).toEqual(before.registeredAt);
  });

  it('AC-2: sessions are revoked, notifications and codes are gone, push tokens cleared', async () => {
    const s1 = await issueSession(personId, dev);
    const s2 = await issueSession(personId, dev);
    await prisma.notification.create({
      data: { id: newId(), recipientId: personId, content: 'Hello', sourceEvent: 'order.created' },
    });
    await prisma.otpChallenge.create({
      data: {
        id: newId(),
        personId,
        target: PHONE,
        purpose: 'LOGIN',
        channel: 'SMS',
        codeHash: 'fixture-hash',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await seedTask();

    expect((await del({ password: PASSWORD })).status).toBe(204);

    const devices = await prisma.device.findMany({ where: { personId } });
    expect(devices.map((d) => d.id).sort()).toEqual([s1.deviceId, s2.deviceId].sort());
    expect(devices.every((d) => d.revokedAt !== null && d.pushToken === null)).toBe(true);
    const tokens = await prisma.refreshToken.findMany({ where: { personId } });
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
    expect(await prisma.notification.count({ where: { recipientId: personId } })).toBe(0);
    expect(await prisma.otpChallenge.count({ where: { personId } })).toBe(0);
    expect(await taskCount()).toBe(0);
  });

  it('AC-3: collaborations are REVOKED with the flag false, history still points to the person', async () => {
    const collab = await prisma.collaboration.create({
      data: {
        id: newId(),
        personId,
        organizationId: SUPPLIER_ORG,
        role: 'MANAGER',
        status: 'ACTIVE',
        isPublicContact: true,
        acceptedAt: REG,
        amountHeld: 7000n,
      },
    });
    const otherOrg = newId();
    const invited = await prisma.$transaction(async (tx) => {
      await tx.organization.create({ data: { id: otherOrg, name: 'Boutique Eto' } });
      await tx.collaboration.create({
        data: {
          id: newId(),
          personId: SUPPLIER_OWNER,
          organizationId: otherOrg,
          role: 'OWNER',
          status: 'ACTIVE',
          acceptedAt: REG,
        },
      });
      return tx.collaboration.create({
        data: {
          id: newId(),
          personId,
          organizationId: otherOrg,
          role: 'SELLER',
          status: 'INVITED',
        },
      });
    });
    const rel = await prisma.customerRelationship.create({
      data: {
        id: newId(),
        supplierOrganizationId: SUPPLIER_ORG,
        customerPersonId: personId,
        creditLimit: 0n,
        balance: 0n,
        createdById: SUPPLIER_OWNER,
      },
    });

    expect((await del({ password: PASSWORD })).status).toBe(204);

    const after = await prisma.collaboration.findUniqueOrThrow({ where: { id: collab.id } });
    expect(after).toMatchObject({ status: 'REVOKED', isPublicContact: false, amountHeld: 7000n });
    const invitedAfter = await prisma.collaboration.findUniqueOrThrow({
      where: { id: invited.id },
    });
    expect(invitedAfter).toMatchObject({ status: 'REVOKED', isPublicContact: false });
    const kept = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: rel.id } });
    expect(kept.customerPersonId).toBe(personId);
  });

  it('AC-4: a positive balance as customer answers 409 DELETION_BLOCKED with the blockers', async () => {
    await prisma.customerRelationship.create({
      data: {
        id: newId(),
        supplierOrganizationId: SUPPLIER_ORG,
        customerPersonId: personId,
        creditLimit: 0n,
        balance: 5000n,
        createdById: SUPPLIER_OWNER,
      },
    });

    const res = await del({ password: PASSWORD });

    expect(res.status).toBe(409);
    expect(errOf(res)?.code).toBe('DELETION_BLOCKED');
    expect(errOf(res)?.blockers).toEqual([{ code: 'POSITIVE_BALANCE', label: 'Grossiste Mbarga' }]);
    expect((await person()).status).toBe('ACTIVE');
    expect((await person()).fullName).toBe('Fixture Person');
  });

  it('AC-4: an owned ACTIVE organization answers 409 DELETION_BLOCKED and changes nothing', async () => {
    const orgId = newId();
    await prisma.$transaction(async (tx) => {
      await tx.organization.create({ data: { id: orgId, name: 'Boutique Fotso' } });
      await tx.collaboration.create({
        data: {
          id: newId(),
          personId,
          organizationId: orgId,
          role: 'OWNER',
          status: 'ACTIVE',
          acceptedAt: REG,
        },
      });
    });

    const res = await del({ password: PASSWORD });

    expect(res.status).toBe(409);
    expect(errOf(res)?.blockers).toEqual([{ code: 'OWNS_ORGANIZATION', label: 'Boutique Fotso' }]);
    const row = await person();
    expect(row.status).toBe('ACTIVE');
    expect(row.phoneNumber).toBe(PHONE);
    const collab = await prisma.collaboration.findFirstOrThrow({ where: { personId } });
    expect(collab.status).toBe('ACTIVE');
  });

  it('AC-4: a wrong password answers 401 INVALID_CREDENTIALS and changes nothing', async () => {
    const res = await del({ password: 'wrong-password-123' });

    expect(res.status).toBe(401);
    expect(errOf(res)?.code).toBe('INVALID_CREDENTIALS');
    expect((await person()).status).toBe('ACTIVE');
  });

  it('AC-4: no password answers 400 VALIDATION_ERROR', async () => {
    for (const body of [{}, undefined, { password: 12 }, { password: PASSWORD, extra: 1 }]) {
      const res = await del(body);
      expect(res.status).toBe(400);
      expect(errOf(res)?.code).toBe('VALIDATION_ERROR');
    }
    expect((await person()).status).toBe('ACTIVE');
  });

  it('wrong passwords count with the login counter of the number and lock it', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await del({ password: 'wrong-password-123' })).status).toBe(401);
    }
    expect(store.get(`login:fail:${PHONE}`)).toBe(5);

    const res = await del({ password: PASSWORD });

    expect(res.status).toBe(429);
    expect(errOf(res)?.code).toBe('LOGIN_LOCKED');
    expect((await person()).status).toBe('ACTIVE');
  });

  it('AC-5: login with the old number and password answers the generic 401', async () => {
    expect((await del({ password: PASSWORD })).status).toBe(204);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone_number: PHONE, password: PASSWORD });

    expect(res.status).toBe(401);
    expect(errOf(res)?.code).toBe('INVALID_CREDENTIALS');
  });

  it('AC-6: when a step fails the person is unchanged', async () => {
    const s = await issueSession(personId, dev);
    await prisma.notification.create({
      data: { id: newId(), recipientId: personId, content: 'Hello', sourceEvent: 'order.created' },
    });
    await seedTask();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION fail_task_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_task_delete BEFORE DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION fail_task_delete()`
    );

    const res = await del({ password: PASSWORD });

    expect(res.status).toBe(500);
    const row = await person();
    expect(row).toMatchObject({
      fullName: 'Fixture Person',
      phoneNumber: PHONE,
      releasedPhoneNumber: null,
      status: 'ACTIVE',
      anonymizedAt: null,
    });
    expect(row.passwordHash).toBe(passwordHash);
    const device = await prisma.device.findUniqueOrThrow({ where: { id: s.deviceId } });
    expect(device.revokedAt).toBeNull();
    expect(device.pushToken).toBe('fixture-push-token');
    expect(await prisma.notification.count({ where: { recipientId: personId } })).toBe(1);
  });

  it('AB-1: a valid token with a wrong password deletes nothing, even for another person row', async () => {
    const res = await del({ password: PASSWORD + 'x' });

    expect(res.status).toBe(401);
    const rows = await prisma.person.findMany({ where: { status: 'ANONYMIZED' } });
    expect(rows).toHaveLength(0);
  });

  it('AB-2: no personal data is left in the person row or its dependents', async () => {
    await issueSession(personId, dev);
    await prisma.notification.create({
      data: { id: newId(), recipientId: personId, content: 'Secret', sourceEvent: 'order.created' },
    });
    await prisma.otpChallenge.create({
      data: {
        id: newId(),
        personId: null,
        target: PHONE,
        purpose: 'LOGIN',
        channel: 'SMS',
        codeHash: 'fixture-hash',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect((await del({ password: PASSWORD })).status).toBe(204);

    const row = await person();
    expect([
      row.fullName,
      row.email,
      row.emailVerifiedAt,
      row.passwordHash,
      row.preferredLanguage,
      row.phoneNumber,
    ]).toEqual([null, null, null, null, null, null]);
    expect(await prisma.notification.count({ where: { recipientId: personId } })).toBe(0);
    expect(
      await prisma.otpChallenge.count({ where: { OR: [{ personId }, { target: PHONE }] } })
    ).toBe(0);
    expect(await prisma.device.count({ where: { personId, pushToken: { not: null } } })).toBe(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).delete(URL).send({ password: PASSWORD });

    expect(res.status).toBe(401);
  });
});
