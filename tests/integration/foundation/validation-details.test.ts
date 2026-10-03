import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { errorHandler } from '../../../src/middleware/error-handler.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';
import { logger } from '../../../src/lib/logger.js';

const schema = z
  .object({
    status: z.enum(['OPEN', 'CLOSED']),
    kind: z.literal('A').optional(),
    ref: z.union([z.literal('X'), z.number()]).optional(),
  })
  .strict();

type Body = {
  error: { code: string; message: string; requestId?: string; details: Record<string, unknown>[] };
};

describe('Validation error details', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    app.post('/t', (req: Request, res: Response) => {
      schema.parse(req.body);
      res.json({ ok: true });
    });
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC-1 keeps path and code', async () => {
    const res = await request(app).post('/t').send({ status: 'LEAK-enum' });
    const body = res.body as Body;
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Validation failed');
    expect(body.error.requestId).toBeTruthy();
    expect(body.error.details).toEqual([{ path: ['status'], code: 'invalid_enum_value' }]);
  });

  it.each([
    [{ status: 'LEAK-enum' }, 'invalid_enum_value', 'LEAK-enum'],
    [{ status: 'OPEN', 'LEAK-key': 1 }, 'unrecognized_keys', 'LEAK-key'],
    [{ status: 'OPEN', kind: 'LEAK-lit' }, 'invalid_literal', 'LEAK-lit'],
    [{ status: 'OPEN', ref: 'LEAK-union' }, 'invalid_union', 'LEAK-union'],
  ])('AC-2 no reflected input %j', async (payload, code, marker) => {
    const res = await request(app).post('/t').send(payload);
    const body = res.body as Body;
    for (const d of body.error.details) {
      expect(Object.keys(d).sort()).toEqual(['code', 'path']);
      expect(d.code).toBe(code);
    }
    expect(JSON.stringify(res.body)).not.toContain(marker);
  });

  it('AC-3 and AB-1 sanitized log', async () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const phone = '+10000000000';
    for (const status of ['LEAK-enum', phone]) {
      spy.mockClear();
      const res = await request(app).post('/t').send({ status });
      const call = spy.mock.calls.find((c) => c[1] === 'Validation error');
      const obj = call?.[0] as Record<string, unknown>;
      expect(obj.details).toEqual((res.body as Body).error.details);
      expect(obj).not.toHaveProperty('errors');
      expect(JSON.stringify(obj)).not.toContain(status);
      expect(JSON.stringify(res.body)).not.toContain(status);
    }
  });
});
