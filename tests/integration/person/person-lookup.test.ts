import type { RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  callerId: '0199a710-7b55-7000-8000-000000000001',
  registered: new Map<string, { id: string; full_name: string | null; registered_at: Date | null }>(),
  consumed: new Map<string, number>(),
}));

vi.mock('../../../src/middleware/auth.js', () => ({
  authMiddleware: ((req, res, next) => {
    if (req.headers.authorization !== 'Bearer valid-token') {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    Object.assign(req, {
      user: { id: state.callerId, personId: state.callerId, sub: state.callerId },
      auth: { personId: state.callerId },
    });
    next();
  }) satisfies RequestHandler,
}));

vi.mock('../../../src/modules/person/person.repository.js', () => ({
  findByActivePhone: vi.fn((phone: string) => Promise.resolve(state.registered.get(phone) ?? null)),
  toPublicPerson: vi.fn((person: { full_name: string | null }) => ({
    phone_number: '+237677123456',
    registered: true,
    public_name: person.full_name,
  })),
}));

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: vi.fn((key: string, limit: number) => {
    const count = (state.consumed.get(key) ?? 0) + 1;
    state.consumed.set(key, count);
    return Promise.resolve({ allowed: count <= limit, remaining: Math.max(limit - count, 0) });
  }),
}));

import { logger } from '../../../src/lib/logger.js';
import { app } from '../../../src/app.js';

const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

const lookup = (phone: string) =>
  request(app)
    .get('/api/v1/people/lookup')
    .query({ phone })
    .set('Authorization', 'Bearer valid-token');

describe('GET /api/v1/people/lookup', () => {
  beforeEach(() => {
    state.registered.clear();
    state.consumed.clear();
    warnSpy.mockClear();
  });

  it('returns the registered person public view for a normalized mobile number', async () => {
    state.registered.set('+237677123456', {
      id: '0199a710-7b55-7000-8000-000000000002',
      full_name: 'Béatrice Ngono',
      registered_at: new Date(),
    });

    const response = await lookup('6 77 12 34 56');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      phone_number: '+237677123456',
      registered: true,
      public_name: 'Béatrice Ngono',
    });
  });

  it.each(['+237699000001', '+237699000002', '+237699000003'])(
    'makes unknown, guest, and released numbers indistinguishable (%s)',
    async (phone) => {
      const response = await lookup(phone);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ phone_number: phone, registered: false, public_name: null });
    }
  );

  it.each([undefined, '+237222123456'])('rejects a missing or non-mobile phone (%s)', async (phone) => {
    const call = request(app)
      .get('/api/v1/people/lookup')
      .set('Authorization', 'Bearer valid-token');
    if (phone !== undefined) call.query({ phone });

    const response = await call;

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('allows 60 lookups in an hour and rejects the 61st', async () => {
    for (let count = 1; count <= 60; count += 1) {
      expect((await lookup('+237699000001')).status).toBe(200);
    }

    const response = await lookup('+237699000001');

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('returns exactly the three permitted public fields', async () => {
    state.registered.set('+237677123456', {
      id: '0199a710-7b55-7000-8000-000000000002',
      full_name: 'Béatrice Ngono',
      registered_at: new Date(),
    });

    const response = await lookup('+237677123456');

    expect(Object.keys(response.body as Record<string, unknown>).sort()).toEqual([
      'phone_number',
      'public_name',
      'registered',
    ]);
    expect(response.body).not.toHaveProperty('email');
    expect(response.body).not.toHaveProperty('id');
  });

  it('limits enumeration across different numbers and records the security event', async () => {
    for (let count = 0; count < 60; count += 1) {
      const suffix = String(count).padStart(6, '0');
      expect((await lookup(`+237699${suffix}`)).status).toBe(200);
    }

    const response = await lookup('+237699999999');

    expect(response.status).toBe(429);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'lookup_rate_limited', personId: state.callerId }),
      expect.any(String)
    );
  });

  it('requires a valid access token', async () => {
    const response = await request(app).get('/api/v1/people/lookup').query({ phone: '+237677123456' });

    expect(response.status).toBe(401);
  });
});
