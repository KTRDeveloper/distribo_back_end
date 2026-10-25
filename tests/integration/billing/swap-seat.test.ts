import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { app } from '../../../src/app.js';
import { prisma } from '../../setup';
import { createAuthenticatedRequest } from '../../helpers/request';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { enforceSeatLimit } from '../../../src/modules/billing/seat-limit.service.js';
import * as notifications from '../../../src/modules/notification/notification.service.js';

const org = uuidv7();
const people = Array.from({ length: 6 }, () => uuidv7());
const seats = Array.from({ length: 6 }, () => uuidv7());
const [owner, a, , c, manager, driver] = people;
const [ownerSeat, aSeat, bSeat, cSeat, managerSeat, driverSeat] = seats;
const now = new Date('2026-10-26T12:00:00Z');
const path = `/api/v1/organizations/${org}/billing/swap-seat`;
const body = () => ({ id: uuidv7(), pause_collaboration_id: aSeat, resume_collaboration_id: cSeat });
const post = (input: unknown, person = owner) => createAuthenticatedRequest(app, person).post(path).send(input);

async function state() {
  return {
    seats: await prisma.collaboration.findMany({ orderBy: { id: 'asc' } }),
    people: await prisma.person.findMany({ orderBy: { id: 'asc' } }),
    events: await prisma.subscriptionEvent.findMany({ orderBy: { id: 'asc' } }),
    notices: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.person.createMany({ data: people.map((id, index) => ({
    id, fullName: 'Fixture Member', phoneNumber: `+22507002900${index.toString().padStart(2, '0')}`,
    phoneVerifiedAt: now, registeredAt: now, passwordHash: 'fixture-hash', preferredLanguage: 'FR',
  })) });
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: org, name: 'Fixture Business', maxCollaborators: 2 } });
    const roles = ['OWNER', 'SELLER', 'SELLER', 'SELLER', 'MANAGER', 'DRIVER'] as const;
    await tx.collaboration.createMany({ data: people.map((personId, index) => ({
      id: seats[index], personId, organizationId: org, role: roles[index],
      status: index === 3 || index > 3 ? 'PAUSED' : 'ACTIVE',
      invitedAt: new Date(now.getTime() + index), acceptedAt: now,
    })) });
  });
});

describe('BIL-029 owner seat swap', () => {
  it('swap: journals the owner, sends notices, snapshots products and survives enforcement', async () => {
    const product = uuidv7();
    const pausedProduct = uuidv7();
    await prisma.product.createMany({ data: [
      { id: product, organizationId: org, name: 'Fixture Product', unit: 'bag', price: 100n },
      { id: pausedProduct, organizationId: org, name: 'Fixture Paused', unit: 'bag', price: 100n, pausedAt: now },
    ] });
    const response = await post(body());
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ paused_collaboration_id: aSeat, resumed_collaboration_id: cSeat });
    const after = await state();
    expect(after.seats.find((seat) => seat.id === aSeat)?.status).toBe('PAUSED');
    expect(after.seats.find((seat) => seat.id === cSeat)?.status).toBe('ACTIVE');
    expect(after.events).toHaveLength(3);
    for (const event of after.events) {
      expect(event).toMatchObject({ actor: 'OWNER', personId: owner, administratorId: null, adminActionId: null, paymentId: null });
    }
    expect(after.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'PAUSED', details: { collaboration_id: aSeat } }),
      expect.objectContaining({ kind: 'RESUMED', details: { collaboration_id: cSeat } }),
      expect.objectContaining({ kind: 'KEEP_CHOICE', details: { collaboration_ids: [bSeat, cSeat], product_ids: [product] } }),
    ]));
    expect(after.notices).toHaveLength(2);
    expect(after.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientId: a, sourceEvent: 'subscription.paused', organizationId: org }),
      expect.objectContaining({ recipientId: c, sourceEvent: 'subscription.resumed', organizationId: org }),
    ]));
    expect(await prisma.$transaction((tx) => enforceSeatLimit(tx, org, 2, new Date()))).toEqual({ paused: [], resumed: [], deferred: [] });
    expect(await state()).toEqual(after);
  });

  it.each([
    ['already paused', cSeat, aSeat, 409, 'SEAT_STATE'],
    ['already active', aSeat, bSeat, 409, 'SEAT_STATE'],
    ['unknown pause', uuidv7(), cSeat, 404, 'NOT_FOUND'],
    ['unknown resume', aSeat, uuidv7(), 404, 'NOT_FOUND'],
    ['owner pause', ownerSeat, cSeat, 404, 'NOT_FOUND'],
    ['owner resume', aSeat, ownerSeat, 404, 'NOT_FOUND'],
  ])('refused: %s', async (_name, pause, resume, status, code) => {
    const before = await state();
    const response = await post({ id: uuidv7(), pause_collaboration_id: pause, resume_collaboration_id: resume });
    expect(response.status).toBe(status);
    expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
    expect(await state()).toEqual(before);
  });

  it('refused: a driver on an open delivery stays active', async () => {
    await prisma.collaboration.update({ where: { id: driverSeat }, data: { status: 'ACTIVE' } });
    const relation = await prisma.customerRelationship.create({ data: {
      id: uuidv7(), supplierOrganizationId: org, customerPersonId: c, createdById: owner,
    } });
    const order = await prisma.order.create({ data: {
      id: uuidv7(), customerRelationshipId: relation.id, placedByParty: 'SUPPLIER', enteredById: owner, totalAmount: 0n,
    } });
    await prisma.delivery.create({ data: { id: uuidv7(), orderId: order.id, assignedToId: driver, departedAt: now } });
    const before = await state();
    const response = await post({ ...body(), pause_collaboration_id: driverSeat });
    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('DRIVER_ON_DELIVERY');
    expect(await state()).toEqual(before);
  });

  it.each([['MANAGER', manager, managerSeat], ['SELLER', a, aSeat], ['DRIVER', driver, driverSeat]])('who may: refuses %s', async (_role, person, seat) => {
    await prisma.collaboration.update({ where: { id: seat }, data: { status: 'ACTIVE' } });
    const before = await state();
    const response = await post(body(), person);
    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await state()).toEqual(before);
  });

  it('who may: requires sign-in', async () => {
    const response = await request(app).post(path).send(body());
    expect(response.status).toBe(401);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
  });

  it.each([
    { ...body(), role: 'OWNER' }, { ...body(), id: 'bad' },
    { ...body(), pause_collaboration_id: 'bad' }, { ...body(), resume_collaboration_id: 'bad' },
    { ...body(), pause_collaboration_id: cSeat },
    { ...body(), pause_collaboration_id: cSeat.toUpperCase() },
  ])('body: rejects invalid input %#', async (input) => {
    const before = await state();
    const response = await post(input);
    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await state()).toEqual(before);
  });

  it('repeat: returns the first answer and only one event set', async () => {
    const input = body();
    const first = await post(input);
    expect(first.status).toBe(201);
    await vi.waitFor(async () => {
      expect(await prisma.idempotencyKey.findFirst({ where: { key: input.id, personId: owner } })).toMatchObject({ statusCode: 201 });
    });
    const before = await state();
    const repeat = await post(input);
    expect(repeat.status).toBe(201);
    expect(repeat.body).toEqual(first.body);
    expect(await state()).toEqual(before);
  });

  it('other business: foreign seats look unknown in either position and never change', async () => {
    const foreignOrg = uuidv7();
    const foreignSeat = uuidv7();
    await prisma.$transaction(async (tx) => {
      await tx.organization.create({ data: { id: foreignOrg, name: 'Fixture Other' } });
      await tx.collaboration.createMany({ data: [
        { id: uuidv7(), personId: manager, organizationId: foreignOrg, role: 'OWNER', status: 'ACTIVE' },
        { id: foreignSeat, personId: driver, organizationId: foreignOrg, role: 'DRIVER', status: 'ACTIVE' },
      ] });
    });
    const before = await state();
    const unknown = await post({ ...body(), pause_collaboration_id: uuidv7() });
    for (const input of [{ ...body(), pause_collaboration_id: foreignSeat }, { ...body(), resume_collaboration_id: foreignSeat }]) {
      const response = await post(input);
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error).toMatchObject({ code: bodyOf<ErrorBody>(unknown).error.code, message: bodyOf<ErrorBody>(unknown).error.message });
    }
    expect(await state()).toEqual(before);
  });

  it('rolls seats, scope versions, events and notices back when the second notice fails', async () => {
    const original = notifications.notify;
    vi.spyOn(notifications, 'notify').mockImplementationOnce(original).mockRejectedValueOnce(new Error('fixture notice failure'));
    const before = await state();
    const response = await post(body());
    expect(response.status).toBe(500);
    expect(await state()).toEqual(before);
  });

  it('serializes competing swaps so only one can resume the same seat', async () => {
    const responses = await Promise.all([post(body()), post({ ...body(), pause_collaboration_id: bSeat })]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const after = await state();
    expect(after.seats.filter((seat) => seat.role !== 'OWNER' && seat.status !== 'PAUSED')).toHaveLength(2);
    expect(after.events).toHaveLength(3);
    expect(after.notices).toHaveLength(2);
  });

  it('swaps invited seats without converting an unaccepted invitation into active membership', async () => {
    await prisma.collaboration.update({ where: { id: aSeat }, data: { status: 'INVITED', acceptedAt: null } });
    await prisma.collaboration.update({ where: { id: cSeat }, data: { acceptedAt: null } });
    const response = await post(body());
    expect(response.status).toBe(201);
    expect(await prisma.collaboration.findUnique({ where: { id: aSeat } })).toMatchObject({ status: 'PAUSED' });
    expect(await prisma.collaboration.findUnique({ where: { id: cSeat } })).toMatchObject({ status: 'INVITED', acceptedAt: null });
  });
});
