import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const { app } = await import('../../../src/app.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const X = '0199c018-0000-7000-8000-000000000001';
const Y = '0199c018-0000-7000-8000-000000000002';
const dev = {
  platform: 'ANDROID' as const,
  model: 'M1',
  app_version: '1.0.0',
  push_token: 'secret-push',
  integrity_verdict: 'OK',
};

async function clean() {
  await prisma.$executeRaw`DELETE FROM refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM devices`;
  await prisma.person.deleteMany({ where: { id: { in: [X, Y] } } });
}
beforeEach(async () => {
  await clean();
  await prisma.person.create({ data: { id: X, fullName: 'Dev X', phoneNumber: '+2250700009411' } });
  await prisma.person.create({ data: { id: Y, fullName: 'Dev Y', phoneNumber: '+2250700009412' } });
});
afterAll(clean);

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const refresh = (t: string) => request(app).post('/api/v1/auth/refresh').send({ refresh_token: t });
type Item = Record<string, unknown>;

describe('devices', () => {
  it('list', async () => {
    const a = await issueSession(X, dev);
    const b = await issueSession(X, dev);
    const c = await issueSession(X, dev);
    await request(app).delete(`/api/v1/auth/devices/${c.deviceId}`).set(auth(a.accessToken));
    const r = await request(app).get('/api/v1/auth/devices').set(auth(b.accessToken));
    expect(r.status).toBe(200);
    const items = (r.body as { items: Item[] }).items;
    expect(items.map((i) => i.id)).toEqual([b.deviceId, a.deviceId]);
    expect(items.map((i) => i.current)).toEqual([true, false]);
  });

  it('remove one', async () => {
    const a = await issueSession(X, dev);
    const b = await issueSession(X, dev);
    const r = await request(app)
      .delete(`/api/v1/auth/devices/${b.deviceId}`)
      .set(auth(a.accessToken));
    expect(r.status).toBe(204);
    expect((await refresh(b.refreshToken)).status).toBe(401);
    const toks = await prisma.refreshToken.findMany({ where: { deviceId: b.deviceId } });
    expect(toks.every((t) => t.revokedReason === 'DEVICE_REMOVED')).toBe(true);
  });

  it('bad id', async () => {
    const a = await issueSession(X, dev);
    const unknown = await request(app)
      .delete('/api/v1/auth/devices/0199c018-0000-7000-8000-0000000000ff')
      .set(auth(a.accessToken));
    expect(unknown.status).toBe(404);
    const bad = await request(app).delete('/api/v1/auth/devices/nope').set(auth(a.accessToken));
    expect(bad.status).toBe(400);
  });

  it('logout all', async () => {
    const a = await issueSession(X, dev);
    const b = await issueSession(X, dev);
    const r = await request(app).post('/api/v1/auth/logout-all').set(auth(a.accessToken));
    expect(r.status).toBe(204);
    expect((await refresh(a.refreshToken)).status).toBe(401);
    expect((await refresh(b.refreshToken)).status).toBe(401);
    const toks = await prisma.refreshToken.findMany({ where: { personId: X } });
    expect(toks.every((t) => t.revokedReason === 'LOGOUT_ALL')).toBe(true);
  });

  it('other person', async () => {
    const a = await issueSession(X, dev);
    const b = await issueSession(Y, dev);
    const r = await request(app)
      .delete(`/api/v1/auth/devices/${b.deviceId}`)
      .set(auth(a.accessToken));
    expect(r.status).toBe(404);
    const list = await request(app).get('/api/v1/auth/devices').set(auth(a.accessToken));
    expect((list.body as { items: Item[] }).items.map((i) => i.id)).toEqual([a.deviceId]);
    expect((await refresh(b.refreshToken)).status).toBe(200);
  });

  it('private fields', async () => {
    const a = await issueSession(X, dev);
    const r = await request(app).get('/api/v1/auth/devices').set(auth(a.accessToken));
    const item = (r.body as { items: Item[] }).items[0];
    expect(Object.keys(item).sort()).toEqual(
      ['app_version', 'created_at', 'current', 'id', 'last_synced_at', 'model', 'platform'].sort()
    );
  });

  it('no token', async () => {
    expect((await request(app).get('/api/v1/auth/devices')).status).toBe(401);
  });
});
