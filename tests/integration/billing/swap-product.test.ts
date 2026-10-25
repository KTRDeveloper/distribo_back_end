import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { app } from '../../../src/app.js';
import { prisma } from '../../setup';
import { createAuthenticatedRequest } from '../../helpers/request';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { enforceLimits } from '../../../src/modules/billing/limits.service.js';
import { lockSubscriptions } from '../../../src/modules/billing/subscription.repository.js';

const ORG = uuidv7();
const OTHER_ORG = uuidv7();
const OWNER = uuidv7();
const MANAGER = uuidv7();
const SELLER = uuidv7();
const DRIVER = uuidv7();
const PAUSE = uuidv7();
const RESUME = uuidv7();
const FOREIGN = uuidv7();
const DELETED = uuidv7();
const NOW = new Date('2026-10-01T00:00:00.000Z');
const path = `/api/v1/organizations/${ORG}/billing/swap-product`;

function body() {
  return { id: uuidv7(), pause_product_id: PAUSE, resume_product_id: RESUME };
}

function send(input: object = body(), personId = OWNER) {
  return createAuthenticatedRequest(app, personId).post(path).send(input);
}

async function snapshot() {
  return {
    products: await prisma.product.findMany({ orderBy: { id: 'asc' } }),
    events: await prisma.subscriptionEvent.findMany({ orderBy: { id: 'asc' } }),
  };
}

beforeEach(async () => {
  await prisma.person.createMany({
    data: [OWNER, MANAGER, SELLER, DRIVER].map((id, index) => ({
      id,
      fullName: 'Fixture Person',
      phoneNumber: `+22507000300${index.toString().padStart(2, '0')}`,
      phoneVerifiedAt: NOW,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
      registeredAt: NOW,
      preferredLanguage: 'FR' as const,
    })),
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name, max_products)
    VALUES (${ORG}::uuid, 'Fixture Business', 30), (${OTHER_ORG}::uuid, 'Other Fixture Business', 30)
  `;
  for (const [personId, role] of [[OWNER, 'OWNER'], [MANAGER, 'MANAGER'], [SELLER, 'SELLER'], [DRIVER, 'DRIVER']] as const) {
    await prisma.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES (${uuidv7()}::uuid, ${personId}::uuid, ${ORG}::uuid, ${role}::"CollaborationRole", 'ACTIVE')
    `;
  }
  for (const id of [PAUSE, ...Array.from({ length: 29 }, () => uuidv7()), RESUME, FOREIGN, DELETED]) {
    await prisma.product.create({
      data: {
        id,
        organizationId: id === FOREIGN ? OTHER_ORG : ORG,
        name: 'Fixture Product',
        pausedAt: id === RESUME ? NOW : null,
        deletedAt: id === DELETED ? NOW : null,
        variants: { create: { id: uuidv7(), name: 'Fixture Variant', unit: 'item', status: 'ACTIVE', price: 100n } },
      },
    });
  }
});

describe('BIL-030 owner product swap', () => {
  it('swaps products at the limit and appends the owner events and current choice', async () => {
    const response = await send();
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ paused_product_id: PAUSE, resumed_product_id: RESUME });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: PAUSE } })).pausedAt).not.toBeNull();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: RESUME } })).pausedAt).toBeNull();
    const events = await prisma.subscriptionEvent.findMany({ where: { organizationId: ORG } });
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.kind).sort()).toEqual(['KEEP_CHOICE', 'PAUSED', 'RESUMED']);
    for (const event of events) {
      expect(event).toMatchObject({ actor: 'OWNER', personId: OWNER, administratorId: null, adminActionId: null, paymentId: null });
    }
    expect(events.find((event) => event.kind === 'PAUSED')?.details).toEqual({ target: 'PRODUCTS', product_id: PAUSE });
    expect(events.find((event) => event.kind === 'RESUMED')?.details).toEqual({ target: 'PRODUCTS', product_id: RESUME });
    const choice = events.find((event) => event.kind === 'KEEP_CHOICE')?.details;
    const productIds = choice && typeof choice === 'object' && !Array.isArray(choice) ? choice.product_ids : null;
    expect(productIds).toContain(RESUME);
    for (const id of [PAUSE, FOREIGN, DELETED]) expect(productIds).not.toContain(id);
    expect(await prisma.product.count({ where: { organizationId: ORG, deletedAt: null, pausedAt: null } })).toBe(30);
  });

  it('keeps the swap when limits are enforced again', async () => {
    expect((await send()).status).toBe(201);
    await prisma.$transaction(async (tx) => {
      await lockSubscriptions(tx, ORG);
      await enforceLimits(tx, ORG, { plan: 'ESSENTIAL', planEndsAt: null, graceEndsAt: null, maxCollaborators: 30, maxProducts: 30 }, new Date());
    });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: PAUSE } })).pausedAt).not.toBeNull();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: RESUME } })).pausedAt).toBeNull();
  });

  it.each([
    ['already paused', RESUME, PAUSE, 409, 'PRODUCT_STATE'],
    ['already on sale', PAUSE, PAUSE, 409, 'PRODUCT_STATE'],
    ['unknown', uuidv7(), RESUME, 404, 'NOT_FOUND'],
    ['deleted', DELETED, RESUME, 404, 'NOT_FOUND'],
  ])('refuses %s without changing products or events', async (_name, pauseId, resumeId, status, code) => {
    const before = await snapshot();
    const input = body();
    if (_name === 'already on sale') {
      input.resume_product_id = (await prisma.product.findFirstOrThrow({ where: { organizationId: ORG, pausedAt: null, deletedAt: null, id: { not: PAUSE } } })).id;
    } else {
      input.pause_product_id = pauseId;
      input.resume_product_id = resumeId;
    }
    const response = await send(input);
    expect(response.status).toBe(status);
    expect(bodyOf<ErrorBody>(response).error).toMatchObject({ code });
    expect(await snapshot()).toEqual(before);
  });

  it.each([MANAGER, SELLER, DRIVER])('forbids a non-owner %s without changes', async (personId) => {
    const before = await snapshot();
    const response = await send(body(), personId);
    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await snapshot()).toEqual(before);
  });

  it('requires authentication', async () => {
    const response = await request(app).post(path).send(body());
    expect(response.status).toBe(401);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
  });

  it('rejects extra fields, malformed UUIDs and identical ids, including case variants', async () => {
    const before = await snapshot();
    for (const input of [
      { ...body(), paused_at: NOW.toISOString() },
      { ...body(), id: 'invalid' },
      { ...body(), pause_product_id: 'invalid' },
      { ...body(), resume_product_id: 'invalid' },
      { ...body(), resume_product_id: PAUSE },
      { ...body(), resume_product_id: PAUSE.toUpperCase() },
    ]) {
      const response = await send(input);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('returns the first answer on an idempotent repeat with one set of events', async () => {
    const input = body();
    const first = await send(input);
    const before = await snapshot();
    const second = await send(input);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await snapshot()).toEqual(before);
    expect(before.events).toHaveLength(3);
  });

  it('hides foreign products with the same response as unknown and deleted products', async () => {
    const before = await snapshot();
    const errors = [];
    for (const id of [FOREIGN, DELETED, uuidv7()]) {
      const response = await send({ ...body(), pause_product_id: id });
      expect(response.status).toBe(404);
      errors.push(bodyOf<ErrorBody>(response).error);
    }
    expect(errors[0]).toMatchObject({ code: 'NOT_FOUND', message: 'Not found' });
    expect(errors.map(({ code, message }) => ({ code, message }))).toEqual(Array(3).fill({ code: 'NOT_FOUND', message: 'Not found' }));
    expect(await snapshot()).toEqual(before);
  });

  it('serializes competing swaps so only one resumes the same paused product', async () => {
    const other = await prisma.product.findFirstOrThrow({ where: { organizationId: ORG, pausedAt: null, deletedAt: null, id: { not: PAUSE } } });
    const responses = await Promise.all([send(), send({ ...body(), pause_product_id: other.id })]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.product.count({ where: { organizationId: ORG, pausedAt: null, deletedAt: null } })).toBe(30);
    expect(await prisma.subscriptionEvent.count({ where: { organizationId: ORG } })).toBe(3);
  });
});
