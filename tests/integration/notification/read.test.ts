import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { signToken } from '../../../src/lib/jwt.js';
import { prisma } from '../../setup';

const A = '0199b004-0000-7000-8000-000000000001';
const B = '0199b004-0000-7000-8000-000000000002';
const personIds = [A, B];
const registeredFields = {
  phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
  registeredAt: new Date('2026-01-01T00:00:00.000Z'),
};
const nid = (n: number) => `0199b004-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;

function post(personId: string, path: string) {
  const token = signToken({ accountId: personId, phoneNumber: '+2250700009301' });
  return request(app).post(`/api/v1/notifications${path}`).set('Authorization', `Bearer ${token}`);
}

const status = async (id: string) =>
  (await prisma.notification.findUniqueOrThrow({ where: { id } })).readStatus;

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.person.createMany({
    data: [
      { id: A, fullName: 'Read A', phoneNumber: '+2250700009301', ...registeredFields },
      { id: B, fullName: 'Read B', phoneNumber: '+2250700009302', ...registeredFields },
    ],
  });
  for (const [i, r] of [A, A, B].entries()) {
    await prisma.notification.create({
      data: { id: nid(i), recipientId: r, sourceEvent: 'order.placed', content: `n${i}` },
    });
  }
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
});

describe('notification read', () => {
  it('mark one is idempotent', async () => {
    expect((await post(A, `/${nid(0)}/read`)).status).toBe(204);
    expect(await status(nid(0))).toBe('READ');
    expect((await post(A, `/${nid(0)}/read`)).status).toBe(204);
  });

  it('mark all only touches own rows', async () => {
    expect((await post(A, '/read-all')).status).toBe(204);
    expect(await status(nid(0))).toBe('READ');
    expect(await status(nid(1))).toBe('READ');
    expect(await status(nid(2))).toBe('UNREAD');
  });

  it('bad id', async () => {
    expect((await post(A, `/${nid(50)}/read`)).status).toBe(404);
    expect((await post(A, '/abc/read')).status).toBe(400);
  });

  it('other person gets 404 and row unchanged', async () => {
    expect((await post(A, `/${nid(2)}/read`)).status).toBe(404);
    expect(await status(nid(2))).toBe('UNREAD');
  });

  it('extra fields rejected', async () => {
    const res = await post(A, `/${nid(0)}/read`).send({ content: 'x', recipient_id: B });
    expect(res.status).toBe(400);
    expect(await status(nid(0))).toBe('UNREAD');
    expect((await post(A, '/read-all').send({ content: 'x' })).status).toBe(400);
  });
});
