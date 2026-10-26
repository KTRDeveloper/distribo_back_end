import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { app } from '../../../src/app.js';
import { prisma } from '../../setup';
import { createAuthenticatedRequest } from '../../helpers/request';
import { bodyOf, type ErrorBody } from '../../helpers/body';

const ORG = '0199c016-0000-7000-8000-000000000001';
const OTHER = '0199c016-0000-7000-8000-000000000002';
const OWNER = '0199c016-0000-7000-8000-000000000011';
const MEMBER = '0199c016-0000-7000-8000-000000000012';
const NOW = new Date('2026-10-26T12:00:00.000Z');
const START = new Date('2026-10-01T12:00:00.000Z');
const END = new Date('2026-11-01T12:00:00.000Z');
const path = `/api/v1/organizations/${ORG}/billing`;
const auth = () => createAuthenticatedRequest(app, OWNER);

type View = {
  plan: string; plan_ends_at: string | null; grace_ends_at: string | null;
  max_collaborators: number | null; max_products: number | null;
  periods: { plan: string; status: string; starts_at: string; ends_at: string }[];
  usage: { collaborators: number; products: number };
  after_end: { plan: string; collaborators_to_pause: number; products_to_pause: number } | null;
};

async function period(
  plan: 'ESSENTIAL' | 'PRO' | 'ENTERPRISE',
  status: 'ACTIVE' | 'SCHEDULED' | 'ENDED' = 'ACTIVE',
  startsAt = START,
  endsAt = END,
  endReason: 'EXPIRED' | 'CLOSED' | null = null,
) {
  return prisma.subscription.create({ data: {
    id: uuidv7(), organizationId: ORG, plan, status, startsAt, endsAt,
    origin: 'GIFT', price: 0n, endReason,
  } });
}

async function seats(active: number, invited = 0) {
  for (let index = 0; index < active + invited; index++) {
    const personId = uuidv7();
    await prisma.person.create({ data: {
      id: personId, phoneNumber: `+225070016${String(index).padStart(4, '0')}`,
      registeredAt: START, fullName: 'Fixture Seat', phoneVerifiedAt: START,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    } });
    await prisma.collaboration.create({ data: {
      id: uuidv7(), organizationId: ORG, personId, role: 'SELLER',
      status: index < active ? 'ACTIVE' : 'INVITED',
    } });
  }
}

async function products(count: number, organizationId = ORG) {
  for (let index = 0; index < count; index++) {
    const productId = uuidv7();
    await prisma.product.create({ data: { id: productId, organizationId, name: `Fixture ${index}` } });
    await prisma.productVariant.create({ data: {
      id: uuidv7(), productId, organizationId, unit: 'piece', price: 100n,
    } });
  }
}

beforeEach(async () => {
  await prisma.person.createMany({ data: [
    { id: OWNER, phoneNumber: '+2250700169011', fullName: 'Fixture Owner',
      registeredAt: START, phoneVerifiedAt: START,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture' },
    { id: MEMBER, phoneNumber: '+2250700169012', fullName: 'Fixture Member',
      registeredAt: START, phoneVerifiedAt: START,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture' },
  ] });
  await prisma.organization.createMany({ data: [
    { id: ORG, name: 'Fixture Business' }, { id: OTHER, name: 'Fixture Other' },
  ] });
  await prisma.collaboration.createMany({ data: [
    { id: uuidv7(), organizationId: ORG, personId: OWNER, role: 'OWNER', status: 'ACTIVE' },
    { id: uuidv7(), organizationId: OTHER, personId: MEMBER, role: 'OWNER', status: 'ACTIVE' },
  ] });
});

describe('BIL-016 owner subscription screen', () => {
  it('running: derives rights, usage and FREE preview without exposing private fields', async () => {
    // Keep the fixture running independently of the real execution date.
    const end = new Date(Date.now() + 30 * 86_400_000);
    const start = new Date(Date.now() - 86_400_000);
    await period('ESSENTIAL', 'ACTIVE', start, end);
    await seats(3, 1);
    await products(40);
    const response = await auth().get(path);
    expect(response.status).toBe(200);
    expect(bodyOf<View>(response)).toEqual({
      plan: 'ESSENTIAL', plan_ends_at: end.toISOString(), grace_ends_at: null,
      max_collaborators: 5, max_products: null,
      periods: [{ plan: 'ESSENTIAL', status: 'ACTIVE', starts_at: start.toISOString(), ends_at: end.toISOString() }],
      usage: { collaborators: 4, products: 40 },
      after_end: { plan: 'FREE', collaborators_to_pause: 2, products_to_pause: 10 },
    });
  });

  it('lower next: lists periods earliest first and previews ESSENTIAL', async () => {
    const end = new Date(Date.now() + 30 * 86_400_000);
    await period('ESSENTIAL', 'SCHEDULED', end, new Date(end.getTime() + 30 * 86_400_000));
    await period('PRO', 'ACTIVE', new Date(Date.now() - 86_400_000), end);
    await seats(8);
    await products(12);
    const response = await auth().get(path);
    expect(response.status).toBe(200);
    const view = bodyOf<View>(response);
    expect(view.plan).toBe('PRO');
    expect(view.periods.map(({ plan, status }) => ({ plan, status }))).toEqual([
      { plan: 'PRO', status: 'ACTIVE' }, { plan: 'ESSENTIAL', status: 'SCHEDULED' },
    ]);
    expect(view.after_end).toEqual({ plan: 'ESSENTIAL', collaborators_to_pause: 3, products_to_pause: 0 });
  });

  it('free: returns FREE, empty periods and no preview', async () => {
    const response = await auth().get(path);
    expect(response.status).toBe(200);
    expect(bodyOf<View>(response)).toEqual({
      plan: 'FREE', plan_ends_at: null, grace_ends_at: null, max_collaborators: 2, max_products: 30,
      periods: [], usage: { collaborators: 0, products: 0 }, after_end: null,
    });
  });

  it.each(['MANAGER', 'SELLER', 'DRIVER'] as const)('who may / team member: denies %s without billing data', async (role) => {
    await prisma.collaboration.create({ data: {
      id: uuidv7(), organizationId: ORG, personId: MEMBER, role, status: 'ACTIVE',
    } });
    const response = await createAuthenticatedRequest(app, MEMBER).get(path);
    expect(response.status).toBe(403);
    expect(Object.keys(bodyOf<ErrorBody>(response))).toEqual(['error']);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('who may: requires authentication', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(401);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
  });

  it('other business: returns the same opaque 404 as an unknown organization', async () => {
    const foreign = await auth().get(`/api/v1/organizations/${OTHER}/billing`);
    const absent = await auth().get(`/api/v1/organizations/${uuidv7()}/billing`);
    expect(foreign.status).toBe(404);
    expect(absent.status).toBe(404);
    const foreignError = bodyOf<ErrorBody>(foreign).error;
    const absentError = bodyOf<ErrorBody>(absent).error;
    expect({ code: foreignError.code, message: foreignError.message }).toEqual({ code: absentError.code, message: absentError.message });
  });

  it('read only: repeated reads change no business, seat, product, period or event', async () => {
    await period('ESSENTIAL', 'ACTIVE', new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
    await seats(1);
    await products(1);
    const snapshot = async () => ({
      organizations: await prisma.organization.findMany({ orderBy: { id: 'asc' } }),
      seats: await prisma.collaboration.findMany({ orderBy: { id: 'asc' } }),
      products: await prisma.product.findMany({ orderBy: { id: 'asc' } }),
      variants: await prisma.productVariant.findMany({ orderBy: { id: 'asc' } }),
      periods: await prisma.subscription.findMany({ orderBy: { id: 'asc' } }),
      events: await prisma.subscriptionEvent.findMany({ orderBy: { id: 'asc' } }),
    });
    const before = await snapshot();
    expect((await auth().get(path)).status).toBe(200);
    expect((await auth().get(path)).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects query fields rather than accepting a client clock or organization override', async () => {
    const response = await auth().get(path).query({ now: NOW.toISOString(), organizationId: OTHER });
    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('computes grace from the last natural expiry despite stale stored FREE rights', async () => {
    const end = new Date(Date.now() - 86_400_000);
    await period('ESSENTIAL', 'ENDED', new Date(end.getTime() - 30 * 86_400_000), end, 'EXPIRED');
    const response = await auth().get(path);
    expect(response.status).toBe(200);
    expect(bodyOf<View>(response)).toMatchObject({
      plan: 'ESSENTIAL', plan_ends_at: end.toISOString(),
      grace_ends_at: new Date(end.getTime() + 7 * 86_400_000).toISOString(),
      periods: [], after_end: { plan: 'FREE', collaborators_to_pause: 0, products_to_pause: 0 },
    });
  });

  it('readAfterEnd uses the exact grace boundary and treats unlimited limits as no excess', async () => {
    const { readAfterEnd } = await import('../../../src/modules/billing/owner-view.service.js');
    await period('ESSENTIAL');
    const boundary = new Date(END.getTime() + 7 * 86_400_000);
    await period('ENTERPRISE', 'SCHEDULED', boundary, new Date(boundary.getTime() + 30 * 86_400_000));
    await seats(3);
    await products(31);
    expect(await readAfterEnd(ORG, NOW)).toEqual({
      plan: 'ENTERPRISE', collaborators_to_pause: 0, products_to_pause: 0,
    });
  });

  it('usage excludes paused, revoked, deleted and foreign seats and unavailable products', async () => {
    await seats(1, 1);
    for (const status of ['PAUSED', 'REVOKED', 'ACTIVE'] as const) {
      const personId = uuidv7();
      await prisma.person.create({ data: {
        id: personId, phoneNumber: `+225070016${status === 'PAUSED' ? '8001' : status === 'REVOKED' ? '8002' : '8003'}`,
        registeredAt: START, fullName: 'Fixture Excluded', phoneVerifiedAt: START,
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
      } });
      await prisma.collaboration.create({ data: {
        id: uuidv7(), organizationId: ORG, personId, role: 'SELLER', status,
        deletedAt: status === 'ACTIVE' ? NOW : null,
      } });
    }
    await products(3);
    const all = await prisma.product.findMany({ where: { organizationId: ORG }, orderBy: { id: 'asc' } });
    await prisma.product.update({ where: { id: all[0].id }, data: { pausedAt: NOW } });
    await prisma.productVariant.updateMany({ where: { productId: all[1].id }, data: { status: 'INACTIVE' } });
    await products(1, OTHER);
    const response = await auth().get(path);
    expect(response.status).toBe(200);
    expect(bodyOf<View>(response).usage).toEqual({ collaborators: 2, products: 1 });
  });
});
