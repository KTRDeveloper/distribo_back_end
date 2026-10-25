import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { app } from '../../../src/app.js';
import { prisma } from '../../setup';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';

const organizationId = uuidv7();
const otherOrganizationId = uuidv7();
const people = Array.from({ length: 6 }, () => uuidv7());
const [ownerId, managerId, sellerId, driverId, outsiderId, otherOwnerId] = people;
const collaborations = Array.from({ length: 5 }, () => uuidv7());
const [ownerSeat, managerSeat, sellerSeat, driverSeat, otherSeat] = collaborations;
const products = Array.from({ length: 5 }, () => uuidv7());
const [firstProduct, secondProduct, pausedProduct, deletedProduct, otherProduct] = products;
const path = `/api/v1/organizations/${organizationId}/billing/keep-choice`;

type ChoiceView = { collaboration_ids: string[]; product_ids: string[] };

function choice() {
  return {
    id: uuidv7(),
    collaboration_ids: [managerSeat, sellerSeat],
    product_ids: [firstProduct, secondProduct, pausedProduct],
  };
}

function send(input: unknown, personId = ownerId) {
  return createAuthenticatedRequest(app, personId).post(path).send(input);
}

function events() {
  return prisma.$queryRaw<
    Array<{
      id: string;
      organizationId: string;
      kind: string;
      actor: string;
      personId: string;
      administratorId: string | null;
      adminActionId: string | null;
      subscriptionId: string | null;
      paymentId: string | null;
      details: ChoiceView;
      occurredAt: Date;
    }>
  >`
    SELECT id, organization_id AS "organizationId", kind, actor, person_id AS "personId",
           administrator_id AS "administratorId", admin_action_id AS "adminActionId",
           subscription_id AS "subscriptionId", payment_id AS "paymentId", details,
           occurred_at AS "occurredAt"
    FROM subscription_events
    WHERE organization_id = ${organizationId}::uuid AND kind = 'KEEP_CHOICE'
    ORDER BY occurred_at, id
  `;
}

beforeEach(async () => {
  await prisma.person.createMany({
    data: people.map((id, index) => ({
      id,
      fullName: `Fixture Person ${index}`,
      phoneNumber: `+22507000980${index.toString().padStart(2, '0')}`,
      phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      preferredLanguage: 'FR',
    })),
  });
  await prisma.$transaction(async (tx) => {
    await tx.organization.createMany({
      data: [
        { id: organizationId, name: 'Fixture Business' },
        { id: otherOrganizationId, name: 'Other Fixture Business' },
      ],
    });
    await tx.collaboration.createMany({
      data: [
        { id: ownerSeat, personId: ownerId, organizationId, role: 'OWNER', status: 'ACTIVE' },
        { id: managerSeat, personId: managerId, organizationId, role: 'MANAGER', status: 'ACTIVE' },
        { id: sellerSeat, personId: sellerId, organizationId, role: 'SELLER', status: 'ACTIVE' },
        { id: driverSeat, personId: driverId, organizationId, role: 'DRIVER', status: 'ACTIVE' },
        {
          id: otherSeat,
          personId: otherOwnerId,
          organizationId: otherOrganizationId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      ],
    });
    for (const id of products) {
      const productOrganizationId = id === otherProduct ? otherOrganizationId : organizationId;
      await tx.product.create({
        data: {
          id,
          organizationId: productOrganizationId,
          name: 'Fixture Product',
          pausedAt: id === pausedProduct ? new Date() : null,
          deletedAt: id === deletedProduct ? new Date() : null,
        },
      });
      await tx.productVariant.create({
        data: {
          id: uuidv7(),
          productId: id,
          organizationId: productOrganizationId,
          unit: 'piece',
          price: 100n,
        },
      });
    }
  });
});

describe('BIL-018 owner keep choice', () => {
  it('stores both lists and only the owner attribution without applying the choice', async () => {
    const input = choice();
    const response = await send(input);
    const view = { collaboration_ids: input.collaboration_ids, product_ids: input.product_ids };
    expect(response.status).toBe(201);
    expect(bodyOf<ChoiceView>(response)).toEqual(view);
    const stored = await events();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      organizationId,
      kind: 'KEEP_CHOICE',
      actor: 'OWNER',
      personId: ownerId,
      administratorId: null,
      adminActionId: null,
      subscriptionId: null,
      paymentId: null,
      details: view,
    });
    expect(
      (await prisma.collaboration.findUniqueOrThrow({ where: { id: driverSeat } })).status
    ).toBe('ACTIVE');
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: pausedProduct } })).pausedAt
    ).not.toBeNull();
  });

  it('appends a later choice and leaves the first event unchanged', async () => {
    expect((await send(choice())).status).toBe(201);
    const first = (await events())[0];
    expect((await send({ id: uuidv7(), collaboration_ids: [], product_ids: [] })).status).toBe(201);
    const stored = await events();
    expect(stored).toHaveLength(2);
    expect(stored[0]).toEqual(first);
    expect(stored[1].details).toEqual({ collaboration_ids: [], product_ids: [] });
  });

  it.each([
    ['unknown seat', 'collaboration_ids', uuidv7()],
    ['owner seat', 'collaboration_ids', ownerSeat],
    ['unknown product', 'product_ids', uuidv7()],
    ['deleted product', 'product_ids', deletedProduct],
    ['foreign seat', 'collaboration_ids', otherSeat],
    ['foreign product', 'product_ids', otherProduct],
  ])('rejects %s with the same opaque error and no partial event', async (_name, field, id) => {
    const response = await send({ ...choice(), [field]: [id] });
    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Not found',
    });
    expect(await events()).toHaveLength(0);
  });

  it.each([managerId, sellerId, driverId])('forbids non-owner %s', async (personId) => {
    const response = await send(choice(), personId);
    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await events()).toHaveLength(0);
  });

  it('requires sign-in', async () => {
    const response = await request(app).post(path).send(choice());
    expect(response.status).toBe(401);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
    expect(await events()).toHaveLength(0);
  });

  it('hides the business from a non-member', async () => {
    const response = await send(choice(), outsiderId);
    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await events()).toHaveLength(0);
  });

  it.each([
    ['unknown field', { extra: 'do-not-leak' }],
    ['101 seats', { collaboration_ids: Array.from({ length: 101 }, () => uuidv7()) }],
    ['101 products', { product_ids: Array.from({ length: 101 }, () => uuidv7()) }],
    ['repeated seat', { collaboration_ids: [managerSeat, managerSeat] }],
    ['repeated product', { product_ids: [firstProduct, firstProduct] }],
    ['bad seat UUID', { collaboration_ids: ['do-not-leak'] }],
    ['bad product UUID', { product_ids: ['do-not-leak'] }],
  ])('validates %s without echoing values', async (_name, patch) => {
    const response = await send({ ...choice(), ...patch });
    expect(response.status).toBe(400);
    const error = bodyOf<ErrorBody>(response).error;
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error).toHaveProperty('details');
    expect(JSON.stringify(error)).not.toContain('do-not-leak');
    expect(await events()).toHaveLength(0);
  });

  it('replays the same gesture with exactly one event', async () => {
    const input = choice();
    const first = await send(input);
    const second = await send(input);
    expect(first.status).toBe(201);
    expect(second.status).toBe(first.status);
    expect(bodyOf<ChoiceView>(second)).toEqual(bodyOf<ChoiceView>(first));
    expect(await events()).toHaveLength(1);
  });

  it('rejects a mixed valid and foreign list atomically', async () => {
    const response = await send({ ...choice(), product_ids: [firstProduct, otherProduct] });
    expect(response.status).toBe(404);
    expect(await events()).toHaveLength(0);
  });

  it('accepts invited and paused seats from the team list', async () => {
    await prisma.collaboration.update({ where: { id: sellerSeat }, data: { status: 'INVITED' } });
    await prisma.collaboration.update({ where: { id: driverSeat }, data: { status: 'PAUSED' } });
    const response = await send({ ...choice(), collaboration_ids: [sellerSeat, driverSeat] });
    expect(response.status).toBe(201);
    expect(await events()).toHaveLength(1);
  });

  it('accepts exactly 100 distinct products', async () => {
    const ids = Array.from({ length: 100 }, () => uuidv7());
    await prisma.product.createMany({
      data: ids.map((id) => ({ id, organizationId, name: 'Boundary Product' })),
    });
    await prisma.productVariant.createMany({
      data: ids.map((productId) => ({
        id: uuidv7(),
        productId,
        organizationId,
        unit: 'piece',
        price: 100n,
      })),
    });
    const response = await send({ id: uuidv7(), collaboration_ids: [], product_ids: ids });
    expect(response.status).toBe(201);
    expect(bodyOf<ChoiceView>(response).product_ids).toEqual(ids);
    expect(await events()).toHaveLength(1);
  });
});
