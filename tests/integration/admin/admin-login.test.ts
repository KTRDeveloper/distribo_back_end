import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { generateSync } from 'otplib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  secondsLeft: (_key: string, windowSeconds: number) => Promise.resolve(windowSeconds),
  resetKey: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
}));

const { app } = await import('../../../src/app.js');
const { adminAuthMiddleware, requireAdminRole } = await import(
  '../../../src/middleware/admin-auth.js'
);
const { errorHandler } = await import('../../../src/middleware/error-handler.js');
const { createTotpSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { signAccessToken } = await import('../../../src/lib/jwt.js');
const { seedAccount } = await import('../../helpers/database.js');
const { newId } = await import('../../../src/shared/ids.js');

const PASSWORD = 'fixture-admin-password-1';

type Body = {
  access_token?: string;
  expires_in?: number;
  role?: string;
  error?: { code: string; message: string };
};

/** Seeds a person and, unless told otherwise, a live administrator with a fresh secret. */
async function seedAdmin(
  opts: {
    role?: 'MODERATOR' | 'SUPER_ADMIN';
    admin?: boolean;
    removed?: boolean;
    suspended?: boolean;
  } = {}
) {
  const person = await seedAccount({
    email: `${newId()}@example.test`,
    password: PASSWORD,
    name: 'Fixture Admin',
  });
  if (opts.suspended) {
    await prisma.person.update({ where: { id: person.id }, data: { status: 'SUSPENDED' } });
  }
  const { secret } = createTotpSecret();
  let administratorId: string | null = null;
  if (opts.admin !== false) {
    administratorId = newId();
    await prisma.administrator.create({
      data: {
        id: administratorId,
        personId: person.id,
        role: opts.role ?? 'MODERATOR',
        totpSecret: encryptSecret(secret),
        removedAt: opts.removed ? new Date() : null,
      },
    });
  }
  return { person, secret, administratorId };
}

const code = (secret: string, offsetSeconds = 0) =>
  generateSync({ secret, epoch: Date.now() / 1000 + offsetSeconds });

/** The error body minus its per-request id, which differs by design. */
const withoutRequestId = (b: Body) => ({
  ...b,
  error: b.error && { code: b.error.code, message: b.error.message },
});

const login = async (body: object) => {
  const res = await request(app).post('/api/v1/admin/auth/login').send(body);
  return { status: res.status, body: res.body as Body };
};

/** A tiny app protected by the admin middleware, since no admin route exists yet. */
const probe = express();
probe.get('/mod', adminAuthMiddleware, requireAdminRole('MODERATOR'), (req, res) => {
  res.json({ role: req.admin?.role });
});
probe.get('/super', adminAuthMiddleware, requireAdminRole('SUPER_ADMIN'), (_req, res) => {
  res.json({ ok: true });
});
probe.use(errorHandler);

beforeEach(() => {
  store.clear();
});

describe('POST /api/v1/admin/auth/login', () => {
  it('sign in: right number, password and code give a 15-minute admin token (AC-1, C-29)', async () => {
    const { person, secret, administratorId } = await seedAdmin({ role: 'SUPER_ADMIN' });

    const { status, body } = await login({
      phone_number: person.phoneNumber,
      password: PASSWORD,
      totp_code: code(secret),
    });

    expect(status).toBe(200);
    expect(body.expires_in).toBe(900);
    expect(body.role).toBe('SUPER_ADMIN');
    expect(Object.keys(body).sort()).toEqual(['access_token', 'expires_in', 'role']);
    const claims = jwt.decode(body.access_token!) as Record<string, unknown>;
    expect(claims).toMatchObject({
      sub: person.id,
      adm: administratorId,
      role: 'SUPER_ADMIN',
      typ: 'admin',
    });
    expect((claims.exp as number) - (claims.iat as number)).toBe(900);
  });

  describe('failures look alike (AC-2)', () => {
    const cases: Array<[string, () => Promise<{ phone: string; password: string; totp: string }>]> =
      [
        [
          'a wrong password',
          async () => {
            const a = await seedAdmin();
            return {
              phone: a.person.phoneNumber,
              password: 'not-the-password',
              totp: code(a.secret),
            };
          },
        ],
        [
          'a wrong code',
          async () => {
            const a = await seedAdmin();
            return { phone: a.person.phoneNumber, password: PASSWORD, totp: '12345a' };
          },
        ],
        [
          'a person who is not an administrator',
          async () => {
            const a = await seedAdmin({ admin: false });
            return { phone: a.person.phoneNumber, password: PASSWORD, totp: code(a.secret) };
          },
        ],
        [
          'a removed administrator',
          async () => {
            const a = await seedAdmin({ removed: true });
            return { phone: a.person.phoneNumber, password: PASSWORD, totp: code(a.secret) };
          },
        ],
        [
          'a suspended person',
          async () => {
            const a = await seedAdmin({ suspended: true });
            return { phone: a.person.phoneNumber, password: PASSWORD, totp: code(a.secret) };
          },
        ],
        [
          'an unknown number',
          () => Promise.resolve({ phone: '+237677000999', password: PASSWORD, totp: '123456' }),
        ],
      ];

    it.each(cases)('%s answers 401 INVALID_CREDENTIALS with one body', async (_label, make) => {
      const c = await make();
      const reference = await login({
        phone_number: '+237677000998',
        password: PASSWORD,
        totp_code: '123456',
      });

      const { status, body } = await login({
        phone_number: c.phone,
        password: c.password,
        totp_code: c.totp,
      });

      expect(status).toBe(401);
      expect(body.error?.code).toBe('INVALID_CREDENTIALS');
      expect(withoutRequestId(body)).toEqual(withoutRequestId(reference.body));
      expect(body.access_token).toBeUndefined();
    });

    it('a reused code answers 401 INVALID_CREDENTIALS', async () => {
      const a = await seedAdmin();
      const input = {
        phone_number: a.person.phoneNumber,
        password: PASSWORD,
        totp_code: code(a.secret),
      };

      expect((await login(input)).status).toBe(200);
      const second = await login(input);

      expect(second.status).toBe(401);
      expect(second.body.error?.code).toBe('INVALID_CREDENTIALS');
    });
  });

  it('lock: after 5 failures the next attempt answers 429 LOGIN_LOCKED, even with right credentials (AC-3)', async () => {
    const a = await seedAdmin();
    const bad = {
      phone_number: a.person.phoneNumber,
      password: 'wrong-password-x',
      totp_code: code(a.secret),
    };

    for (let i = 0; i < 5; i++) expect((await login(bad)).status).toBe(401);
    const locked = await login({
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      totp_code: code(a.secret),
    });

    expect(locked.status).toBe(429);
    expect(locked.body.error?.code).toBe('LOGIN_LOCKED');
  });

  it('the lock counter is the administration one, apart from the ordinary login (AC-3)', async () => {
    const a = await seedAdmin();
    for (let i = 0; i < 5; i++) {
      await login({
        phone_number: a.person.phoneNumber,
        password: 'wrong-password-x',
        totp_code: '123456',
      });
    }
    expect(store.get(`admin:${a.person.phoneNumber}`)).toBe(5);
    expect(store.get(`login:fail:${a.person.phoneNumber}`)).toBeUndefined();
  });

  it('a success clears the failure counter', async () => {
    const a = await seedAdmin();
    await login({
      phone_number: a.person.phoneNumber,
      password: 'wrong-password-x',
      totp_code: '123456',
    });
    await login({
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      totp_code: code(a.secret),
    });

    expect(store.get(`admin:${a.person.phoneNumber}`)).toBeUndefined();
  });

  it('rejects an unknown field or a missing field with 400 VALIDATION_ERROR', async () => {
    const a = await seedAdmin();

    const extra = await login({
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      totp_code: code(a.secret),
      role: 'SUPER_ADMIN',
    });
    const missing = await login({ phone_number: a.person.phoneNumber, password: PASSWORD });

    expect(extra.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(missing.body.access_token).toBeUndefined();
  });
});

describe('token types (AC-4, AB-2)', () => {
  it('a normal access token on an admin route answers 401', async () => {
    const a = await seedAdmin();
    const normal = signAccessToken({ personId: a.person.id, deviceId: newId() });

    const res = await request(probe).get('/mod').set('Authorization', `Bearer ${normal}`);

    expect(res.status).toBe(401);
  });

  it("a customer's token on an admin route answers 401", async () => {
    const customer = await seedAccount({
      email: `${newId()}@example.test`,
      password: PASSWORD,
      name: 'Fixture Customer',
    });
    const token = signAccessToken({ personId: customer.id, deviceId: newId() });

    const res = await request(probe).get('/mod').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('an admin token on a normal route answers 401', async () => {
    const a = await seedAdmin();
    const { body } = await login({
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      totp_code: code(a.secret),
    });

    const res = await request(app)
      .get('/api/v1/auth/devices')
      .set('Authorization', `Bearer ${body.access_token}`);

    expect(res.status).toBe(401);
  });

  it('no header, a wrong-algorithm or a wrong-signature token answers 401', async () => {
    const a = await seedAdmin();
    const claims = { adm: a.administratorId, role: 'MODERATOR', typ: 'admin' };
    const forged = jwt.sign(claims, 'another-secret-another-secret-another', {
      subject: a.person.id,
    });
    const hs512 = jwt.sign(claims, process.env.JWT_SECRET!, {
      algorithm: 'HS512',
      subject: a.person.id,
    });

    expect((await request(probe).get('/mod')).status).toBe(401);
    expect((await request(probe).get('/mod').set('Authorization', `Bearer ${forged}`)).status).toBe(
      401
    );
    expect((await request(probe).get('/mod').set('Authorization', `Bearer ${hs512}`)).status).toBe(
      401
    );
  });

  it('a valid admin token passes; a MODERATOR is refused on a SUPER_ADMIN route with 403', async () => {
    const a = await seedAdmin({ role: 'MODERATOR' });
    const { body } = await login({
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      totp_code: code(a.secret),
    });
    const auth = `Bearer ${body.access_token}`;

    const ok = await request(probe).get('/mod').set('Authorization', auth);
    const refused = await request(probe).get('/super').set('Authorization', auth);

    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ role: 'MODERATOR' });
    expect(refused.status).toBe(403);
  });
});

describe('removed while signed in (AC-5)', () => {
  it('a removed administrator with a still valid token answers 401', async () => {
    const a = await seedAdmin();
    const { body } = await login({
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      totp_code: code(a.secret),
    });
    const auth = `Bearer ${body.access_token}`;
    expect((await request(probe).get('/mod').set('Authorization', auth)).status).toBe(200);

    await prisma.administrator.update({
      where: { id: a.administratorId! },
      data: { removedAt: new Date() },
    });
    const res = await request(probe).get('/mod').set('Authorization', auth);

    expect(res.status).toBe(401);
  });
});

describe('password alone (AB-1)', () => {
  it('the right password with no code or a wrong code issues no token', async () => {
    const a = await seedAdmin();

    const none = await login({ phone_number: a.person.phoneNumber, password: PASSWORD });
    const empty = await login({
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      totp_code: '',
    });
    const wrong = await login({
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      totp_code: code(a.secret, -3600),
    });

    for (const r of [none, empty, wrong]) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.body.access_token).toBeUndefined();
    }
  });
});
