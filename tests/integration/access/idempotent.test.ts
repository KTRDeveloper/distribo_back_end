import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idempotent } from '../../../src/middleware/idempotent.js';
import { newId } from '../../../src/shared/ids.js';
import { prisma } from '../../setup.js';

const PERSON_A = '019a0000-0000-7000-8000-000000000001';
const PERSON_B = '019a0000-0000-7000-8000-000000000002';

function buildApp(personId: string, handler: RequestHandler) {
  const app = express();
  app.use(express.json());
  app.post(
    '/gesture',
    (req, _res, next) => {
      req.user = { id: personId, phoneNumber: '+237600000000' };
      next();
    },
    idempotent(),
    handler
  );
  return app;
}

describe('idempotent middleware', () => {
  beforeEach(async () => {
    await prisma.idempotencyKey.deleteMany();
    await prisma.person.createMany({
      data: [
        { id: PERSON_A, fullName: 'Test Person A', phoneNumber: '+237600000001' },
        { id: PERSON_B, fullName: 'Test Person B', phoneNumber: '+237600000002' },
      ],
      skipDuplicates: true,
    });
  });

  afterEach(async () => {
    await prisma.idempotencyKey.deleteMany();
    await prisma.person.deleteMany({ where: { id: { in: [PERSON_A, PERSON_B] } } });
  });

  it('runs a first request once and stores its response', async () => {
    const handler = vi.fn<RequestHandler>((_req, res) => res.status(201).json({ result: 'created' }));
    const id = newId();

    const response = await request(buildApp(PERSON_A, handler)).post('/gesture').send({ id });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ result: 'created' });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(
      prisma.idempotencyKey.findUnique({ where: { personId_key: { personId: PERSON_A, key: id } } })
    ).resolves.toMatchObject({ statusCode: 201, responseBody: { result: 'created' } });
  });

  it('replays the first response without running the handler again', async () => {
    const handler = vi.fn<RequestHandler>((_req, res) => res.status(202).json({ owner: 'a' }));
    const app = buildApp(PERSON_A, handler);
    const id = newId();

    const first = await request(app).post('/gesture').send({ id });
    const replay = await request(app).post('/gesture').send({ id });

    expect(replay.status).toBe(first.status);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('scopes the same key to each person', async () => {
    const handlerA = vi.fn<RequestHandler>((_req, res) => res.json({ owner: 'a' }));
    const handlerB = vi.fn<RequestHandler>((_req, res) => res.json({ owner: 'b' }));
    const id = newId();

    await request(buildApp(PERSON_A, handlerA)).post('/gesture').send({ id });
    const responseB = await request(buildApp(PERSON_B, handlerB)).post('/gesture').send({ id });

    expect(responseB.body).toEqual({ owner: 'b' });
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it('allows only one concurrent request to execute the handler', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn<RequestHandler>(async (_req, res) => {
      await held;
      res.status(201).json({ result: 'once' });
    });
    const app = buildApp(PERSON_A, handler);
    const id = newId();

    const firstPromise = request(app).post('/gesture').send({ id }).then((response) => response);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    const secondPromise = request(app).post('/gesture').send({ id }).then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(conflict.body).toMatchObject({ error: { code: 'REQUEST_IN_PROGRESS' } });
  });

  it.each([
    ['missing', {}],
    ['number', { id: 123 }],
    ['UUIDv4', { id: '550e8400-e29b-41d4-a716-446655440000' }],
  ])('rejects an invalid id: %s', async (_label, body) => {
    const handler = vi.fn<RequestHandler>((_req, res) => res.sendStatus(204));

    const response = await request(buildApp(PERSON_A, handler)).post('/gesture').send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('removes a failed request key so a retry runs again', async () => {
    const handler = vi
      .fn<RequestHandler>()
      .mockImplementationOnce((_req, res) => res.status(500).json({ error: 'failed' }))
      .mockImplementationOnce((_req, res) => res.status(201).json({ result: 'retried' }));
    const app = buildApp(PERSON_A, handler);
    const id = newId();

    const failed = await request(app).post('/gesture').send({ id });
    const retried = await request(app).post('/gesture').send({ id });

    expect(failed.status).toBe(500);
    expect(retried.status).toBe(201);
    expect(retried.body).toEqual({ result: 'retried' });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
