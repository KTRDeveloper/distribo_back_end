import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { signToken } from '../../../src/lib/jwt.js';
import { prisma } from '../../setup';

const A = '0199b003-0000-7000-8000-000000000001';
const B = '0199b003-0000-7000-8000-000000000002';
const personIds = [A, B];
const registeredFields = {
  phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
  registeredAt: new Date('2026-01-01T00:00:00.000Z'),
};
const nid = (n: number) => `0199b003-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;

type Body = { items: Array<{ id: string; content: string }>; next_cursor: string | null };
const body = (res: { body: unknown }) => res.body as Body;

function get(personId: string, query = '') {
  const token = signToken({ accountId: personId, phoneNumber: '+2250700009201' });
  return request(app).get(`/api/v1/notifications${query}`).set('Authorization', `Bearer ${token}`);
}

async function seed(recipientId: string, n: number, offset = 0) {
  for (let i = 0; i < n; i++) {
    await prisma.notification.create({
      data: {
        id: nid(offset + i),
        recipientId,
        sourceEvent: 'order.placed',
        content: `n${offset + i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, offset + i)),
      },
    });
  }
}

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.person.createMany({
    data: [
      { id: A, fullName: 'List A', phoneNumber: '+2250700009201', ...registeredFields },
      { id: B, fullName: 'List B', phoneNumber: '+2250700009202', ...registeredFields },
    ],
  });
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
});

describe('GET /api/v1/notifications', () => {
  it('lists own rows newest first', async () => {
    await seed(A, 3);
    const res = await get(A);
    expect(res.status).toBe(200);
    expect(body(res).items.map((i) => i.content)).toEqual(['n2', 'n1', 'n0']);
    expect(body(res).next_cursor).toBeNull();
    expect(Object.keys(body(res).items[0] ?? {}).sort()).toEqual(
      [
        'content',
        'created_at',
        'id',
        'organization_id',
        'read_status',
        'related_entity_id',
        'related_entity_type',
        'source_event',
      ].sort()
    );
  });

  it('filters unread', async () => {
    await seed(A, 3);
    await prisma.notification.update({ where: { id: nid(1) }, data: { readStatus: 'READ' } });
    const res = await get(A, '?unread=true');
    expect(res.status).toBe(200);
    expect(body(res).items).toHaveLength(2);
  });

  it('pages without repeats', async () => {
    await seed(A, 5);
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(A, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      sizes.push(body(res).items.length);
      seen.push(...body(res).items.map((i) => i.id));
      cursor = body(res).next_cursor;
    } while (cursor);
    expect(sizes).toEqual([2, 2, 1]);
    expect(new Set(seen).size).toBe(5);
  });

  it('never shows another person rows', async () => {
    await seed(B, 2, 50);
    await seed(A, 1);
    const res = await get(A);
    expect(body(res).items).toHaveLength(1);
  });

  it('rejects a request without token', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });
});
