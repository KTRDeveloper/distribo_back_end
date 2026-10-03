import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import express from 'express';
import request from 'supertest';
import { signAccessToken, verifyAccessToken } from '../../../src/lib/jwt.js';
import { authMiddleware } from '../../../src/middleware/auth.js';

const SECRET = process.env.JWT_SECRET as string;
const personId = '018f0000-0000-7000-8000-0000000000aa';
const deviceId = '018f0000-0000-7000-8000-0000000000bb';
const claims = { sub: personId, did: deviceId, typ: 'access' };

function b64(o: object) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

const bad: Record<string, string> = {
  expired: jwt.sign(claims, SECRET, { expiresIn: -10 }),
  'other secret': jwt.sign(claims, 'x'.repeat(40), { expiresIn: '5m' }),
  'alg none': `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, exp: 9999999999 })}.`,
  HS512: jwt.sign(claims, SECRET, { algorithm: 'HS512', expiresIn: '5m' }),
  'missing did': jwt.sign({ sub: personId, typ: 'access' }, SECRET, { expiresIn: '5m' }),
  'typ refresh': jwt.sign({ ...claims, typ: 'refresh' }, SECRET, { expiresIn: '5m' }),
};

describe('access token payload', () => {
  it('carries sub, did, typ, iat, exp +15m and no phone', () => {
    const d = jwt.decode(signAccessToken({ personId, deviceId })) as Record<string, unknown>;
    expect(d.sub).toBe(personId);
    expect(d.did).toBe(deviceId);
    expect(d.typ).toBe('access');
    expect((d.exp as number) - (d.iat as number)).toBe(900);
    expect(Object.keys(d).sort()).toEqual(['did', 'exp', 'iat', 'sub', 'typ']);
  });
});

describe('access token verification', () => {
  it('accepts a fresh token', () => {
    expect(verifyAccessToken(signAccessToken({ personId, deviceId }))).toEqual({
      personId,
      deviceId,
    });
  });
  for (const [name, token] of Object.entries(bad)) {
    it(`rejects ${name}`, () => {
      expect(() => verifyAccessToken(token)).toThrow();
    });
  }
});

describe('auth middleware', () => {
  const app = express();
  app.get('/me', authMiddleware, (req, res) => {
    res.json(req.user);
  });

  it('sets req.user', async () => {
    const t = signAccessToken({ personId, deviceId });
    const res = await request(app).get('/me').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: personId, deviceId });
  });
  it('401 UNAUTHORIZED without header', async () => {
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });
  for (const [name, token] of Object.entries(bad)) {
    it(`401 INVALID_TOKEN for ${name}`, async () => {
      const res = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_TOKEN');
    });
  }
});
