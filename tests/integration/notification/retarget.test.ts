import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { retargetNotifications } from '../../../src/modules/notification/notification.service.js';
import { prisma } from '../../setup';

const A = '0199b005-0000-7000-8000-000000000001';
const B = '0199b005-0000-7000-8000-000000000002';
const personIds = [A, B];
const O1 = '0199b005-0000-7000-8000-0000000000a1';
const O2 = '0199b005-0000-7000-8000-0000000000a2';
const O3 = '0199b005-0000-7000-8000-0000000000a3';
const nid = (n: number) => `0199b005-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;
const registeredFields = {
  phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
  registeredAt: new Date('2026-01-01T00:00:00.000Z'),
};

async function seed(
  n: number,
  recipientId: string,
  type: string,
  relatedId: string,
  readStatus: 'READ' | 'UNREAD' = 'UNREAD'
) {
  await prisma.notification.create({
    data: {
      id: nid(n),
      recipientId,
      sourceEvent: 'order.placed',
      content: `n${n}`,
      relatedEntityType: type,
      relatedEntityId: relatedId,
      readStatus,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
    },
  });
}

const retarget = (type: string, fromId: string, toId: string) =>
  prisma.$transaction((tx) => retargetNotifications(tx, { type, fromId, toId }));

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.person.createMany({
    data: [
      { id: A, fullName: 'Retarget A', phoneNumber: '+2250700009501', ...registeredFields },
      { id: B, fullName: 'Retarget B', phoneNumber: '+2250700009502', ...registeredFields },
    ],
  });
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
});

describe('retargetNotifications', () => {
  it('moves the notifications of one order and keeps everything else', async () => {
    await seed(1, A, 'order', O1);
    await seed(2, B, 'order', O1, 'READ');
    await seed(3, A, 'order', O2);
    const before = await prisma.notification.findMany({ orderBy: { id: 'asc' } });

    expect(await retarget('order', O1, O3)).toBe(2);

    const after = await prisma.notification.findMany({ orderBy: { id: 'asc' } });
    expect(after.map((r) => r.relatedEntityId)).toEqual([O3, O3, O2]);
    for (const [i, row] of after.entries()) {
      const old = before[i];
      expect({ ...row, relatedEntityId: null, serverUpdatedAt: null }).toEqual({
        ...old,
        relatedEntityId: null,
        serverUpdatedAt: null,
      });
    }
    expect(after[1]?.readStatus).toBe('READ');
    expect(after[2]?.serverUpdatedAt).toEqual(before[2]?.serverUpdatedAt);
  });

  it('never moves another entity type', async () => {
    await seed(1, A, 'customer_relationship', O1);
    const before = await prisma.notification.findUniqueOrThrow({ where: { id: nid(1) } });

    expect(await retarget('order', O1, O3)).toBe(0);

    expect(await prisma.notification.findUniqueOrThrow({ where: { id: nid(1) } })).toEqual(before);
  });

  it('bumps server_updated_at so phones pull the change', async () => {
    await seed(1, A, 'order', O1);
    const before = await prisma.notification.findUniqueOrThrow({ where: { id: nid(1) } });

    await retarget('order', O1, O3);

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: nid(1) } });
    expect(after.serverUpdatedAt.getTime()).toBeGreaterThan(before.serverUpdatedAt.getTime());
  });
});
