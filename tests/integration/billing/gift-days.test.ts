import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { signAccessToken, signAdminToken } from '../../../src/lib/jwt.js';
import * as adjustment from '../../../src/modules/billing/adjustment-notice.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { prisma } from '../../setup.js';

const ORG = '0199c023-0000-7000-8000-000000000001';
const OTHER_ORG = '0199c023-0000-7000-8000-000000000002';
const OWNER = '0199c023-0000-7000-8000-000000000011';
const ADMIN_PERSON = '0199c023-0000-7000-8000-000000000012';
const MOD_PERSON = '0199c023-0000-7000-8000-000000000013';
const ADMIN = '0199c023-0000-7000-8000-000000000021';
const MOD = '0199c023-0000-7000-8000-000000000022';
const GIFT = '0199c023-0000-7000-8000-000000000031';
const NOW = new Date('2026-10-26T00:00:00.000Z');
const input = { id: GIFT, plan: 'PRO', days: 30, reason: 'Fixture compensation' };
const url = (organizationId = ORG) => `/api/v1/admin/organizations/${organizationId}/billing/gift-days`;
const token = (role: 'SUPER_ADMIN' | 'MODERATOR' = 'SUPER_ADMIN') => signAdminToken({
  personId: role === 'SUPER_ADMIN' ? ADMIN_PERSON : MOD_PERSON,
  administratorId: role === 'SUPER_ADMIN' ? ADMIN : MOD,
  role,
});

async function counts() {
  return {
    periods: await prisma.subscription.count(),
    actions: await prisma.adminAction.count(),
    events: await prisma.subscriptionEvent.count(),
    notices: await prisma.notification.count(),
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await prisma.person.createMany({ data: [OWNER, ADMIN_PERSON, MOD_PERSON].map((id, index) => ({
    id, fullName: 'Fixture Person', phoneNumber: `+22507000230${index}1`,
    phoneVerifiedAt: NOW, registeredAt: NOW, preferredLanguage: 'FR',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
  })) });
  await prisma.administrator.createMany({ data: [
    { id: ADMIN, personId: ADMIN_PERSON, role: 'SUPER_ADMIN', totpSecret: 'fixture-encrypted-secret' },
    { id: MOD, personId: MOD_PERSON, role: 'MODERATOR', totpSecret: 'fixture-encrypted-secret' },
  ] });
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: ORG, name: 'Fixture Business' } });
    await tx.collaboration.create({ data: {
      id: '0199c023-0000-7000-8000-000000000041', personId: OWNER,
      organizationId: ORG, role: 'OWNER', status: 'ACTIVE',
    } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('BIL-023 administrator gift days', () => {
  it('gift: schedules after the queue and records administrator attribution and owner notice', async () => {
    await prisma.subscription.create({ data: {
      id: '0199c023-0000-7000-8000-000000000032', organizationId: ORG,
      plan: 'ESSENTIAL', origin: 'GIFT', price: 0n, status: 'ACTIVE',
      startsAt: NOW, endsAt: new Date('2026-11-01T00:00:00.000Z'),
    } });
    const response = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    expect(response.status).toBe(201);
    expect(bodyOf<unknown>(response)).toEqual({
      id: GIFT, plan: 'PRO', days: 30, status: 'SCHEDULED',
      starts_at: '2026-11-01T00:00:00.000Z', ends_at: '2026-12-01T00:00:00.000Z',
    });
    const [action] = await prisma.adminAction.findMany();
    expect(action).toMatchObject({
      administratorId: ADMIN, action: 'GIFT_DAYS', targetOrganizationId: ORG,
      targetPersonId: null, reason: input.reason,
    });
    const [event] = await prisma.subscriptionEvent.findMany();
    expect(event).toMatchObject({
      kind: 'FORFAIT_ADDED', actor: 'ADMINISTRATOR', administratorId: ADMIN,
      adminActionId: action.id, subscriptionId: GIFT, personId: null, paymentId: null,
    });
    const [notice] = await prisma.notification.findMany();
    expect(notice).toMatchObject({ recipientId: OWNER, organizationId: ORG, sourceEvent: 'subscription.adjusted' });
    expect(notice.content).not.toContain(input.reason);
    expect(await counts()).toEqual({ periods: 2, actions: 1, events: 1, notices: 1 });
  });

  it('free plan: activates PRO immediately and restores two paused collaborators', async () => {
    await prisma.collaboration.createMany({ data: [ADMIN_PERSON, MOD_PERSON].map((personId, index) => ({
      id: `0199c023-0000-7000-8000-00000000005${index}`, personId,
      organizationId: ORG, role: 'SELLER' as const, status: 'PAUSED' as const, acceptedAt: NOW,
    })) });
    const response = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    expect(response.status).toBe(201);
    expect(bodyOf<{ status: string; starts_at: string }>(response)).toMatchObject({ status: 'ACTIVE', starts_at: NOW.toISOString() });
    expect(await prisma.organization.findUnique({ where: { id: ORG } })).toMatchObject({
      plan: 'PRO', maxCollaborators: 10, maxProducts: null,
    });
    expect(await prisma.collaboration.count({ where: { organizationId: ORG, status: 'ACTIVE' } })).toBe(3);
    expect(await prisma.notification.count({ where: { sourceEvent: 'subscription.adjusted', recipientId: OWNER } })).toBe(1);
  });

  it('repeat: returns the same fields without writes and rejects different days or plan', async () => {
    const first = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    const second = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(bodyOf<unknown>(second)).toEqual(bodyOf<unknown>(first));
    for (const changes of [{ days: 31 }, { plan: 'ENTERPRISE' }]) {
      const conflict = await request(app).post(url()).auth(token(), { type: 'bearer' }).send({ ...input, ...changes });
      expect(conflict.status).toBe(409);
      expect(bodyOf<ErrorBody>(conflict).error.code).toBe('ID_USED');
    }
    expect(await counts()).toEqual({ periods: 1, actions: 1, events: 1, notices: 1 });
  });

  it.each([
    { days: 0 }, { days: 366 }, { days: 1.5 }, { plan: 'FREE' },
    { reason: undefined }, { reason: '' }, { reason: 'x'.repeat(2001) },
    { administratorId: ADMIN }, { id: 'bad-id' },
  ])('refused: rejects invalid body %j without writes', async (changes) => {
    const response = await request(app).post(url()).auth(token(), { type: 'bearer' }).send({ ...input, ...changes });
    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await counts()).toEqual({ periods: 0, actions: 0, events: 0, notices: 0 });
  });

  it('refused: requires an admin token and an existing business', async () => {
    const unauthenticated = await request(app).post(url()).send(input);
    expect(unauthenticated.status).toBe(401);
    expect(bodyOf<ErrorBody>(unauthenticated).error.code).toBe('UNAUTHORIZED');
    const missing = await request(app).post(url(OTHER_ORG)).auth(token(), { type: 'bearer' }).send(input);
    expect(missing.status).toBe(404);
    expect(bodyOf<ErrorBody>(missing).error.code).toBe('NOT_FOUND');
    expect(await counts()).toEqual({ periods: 0, actions: 0, events: 0, notices: 0 });
  });

  it('moderator: rejects moderators before validation and rejects app tokens', async () => {
    for (const body of [input, { days: 0 }]) {
      const response = await request(app).post(url()).auth(token('MODERATOR'), { type: 'bearer' }).send(body);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    const appToken = signAccessToken({ personId: OWNER, deviceId: GIFT });
    const response = await request(app).post(url()).auth(appToken, { type: 'bearer' }).send(input);
    expect(response.status).toBe(401);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
    expect(await counts()).toEqual({ periods: 0, actions: 0, events: 0, notices: 0 });
  });

  it('serializes simultaneous repeats into a single gift, action, event and notice', async () => {
    const responses = await Promise.all(Array.from({ length: 3 }, () =>
      request(app).post(url()).auth(token(), { type: 'bearer' }).send(input)));
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(bodyOf<unknown>(responses[1])).toEqual(bodyOf<unknown>(responses[0]));
    expect(await counts()).toEqual({ periods: 1, actions: 1, events: 1, notices: 1 });
  });

  it('rejects an id belonging to another business or to a non-gift period', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.organization.create({ data: { id: OTHER_ORG, name: 'Fixture Other Business' } });
      await tx.collaboration.create({ data: {
        id: '0199c023-0000-7000-8000-000000000061', personId: ADMIN_PERSON,
        organizationId: OTHER_ORG, role: 'OWNER', status: 'ACTIVE',
      } });
    });
    await prisma.subscription.create({ data: {
      id: GIFT, organizationId: OTHER_ORG, plan: 'PRO', origin: 'GIFT', price: 0n,
      status: 'ACTIVE', startsAt: NOW, endsAt: new Date('2026-11-25T00:00:00.000Z'),
    } });
    const foreign = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    expect(foreign.status).toBe(409);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe('ID_USED');
    await prisma.subscription.update({ where: { id: GIFT }, data: { organizationId: ORG, origin: 'CONVERSION' } });
    const conversion = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    expect(conversion.status).toBe(409);
    expect(bodyOf<ErrorBody>(conversion).error.code).toBe('ID_USED');
    expect(await counts()).toEqual({ periods: 1, actions: 0, events: 0, notices: 0 });
  });

  it('returns ID_USED when two businesses concurrently use the same gift id', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.organization.create({ data: { id: OTHER_ORG, name: 'Fixture Other Business' } });
      await tx.collaboration.create({ data: {
        id: '0199c023-0000-7000-8000-000000000061', personId: ADMIN_PERSON,
        organizationId: OTHER_ORG, role: 'OWNER', status: 'ACTIVE',
      } });
    });
    const responses = await Promise.all([ORG, OTHER_ORG].map((organizationId) =>
      request(app).post(url(organizationId)).auth(token(), { type: 'bearer' }).send(input)));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const conflict = responses.find((response) => response.status === 409)!;
    expect(bodyOf<ErrorBody>(conflict).error.code).toBe('ID_USED');
    expect(await counts()).toEqual({ periods: 1, actions: 1, events: 1, notices: 1 });
  });

  it('rolls back action, gift, event and rights when the adjustment notice fails', async () => {
    vi.spyOn(adjustment, 'notifyOwnerOfAdjustment').mockRejectedValueOnce(new Error('Fixture notice failure'));
    const response = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    expect(response.status).toBe(500);
    expect(await counts()).toEqual({ periods: 0, actions: 0, events: 0, notices: 0 });
    expect(await prisma.organization.findUnique({ where: { id: ORG } })).toMatchObject({ plan: 'FREE', planEndsAt: null });
  });
});
