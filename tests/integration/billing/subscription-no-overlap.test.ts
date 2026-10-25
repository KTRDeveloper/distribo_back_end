import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG_ID = '0199c032-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c032-0000-7000-8000-000000000002';
const OWNER_ID = '0199c032-0000-7000-8000-000000000011';
const FIRST_ID = '0199c032-0000-7000-8000-000000000021';
const SECOND_ID = '0199c032-0000-7000-8000-000000000022';
const THIRD_ID = '0199c032-0000-7000-8000-000000000023';
const JAN = new Date('2026-01-01T00:00:00.000Z');
const MID_JAN = new Date('2026-01-15T00:00:00.000Z');
const FEB = new Date('2026-02-01T00:00:00.000Z');
const MAR = new Date('2026-03-01T00:00:00.000Z');

function period(id: string, startsAt: Date, endsAt: Date, organizationId = ORG_ID) {
  return {
    id,
    organizationId,
    plan: 'PRO' as const,
    origin: 'GIFT' as const,
    status: 'SCHEDULED' as const,
    price: 0n,
    startsAt,
    endsAt,
  };
}

beforeEach(async () => {
  await prisma.person.create({
    data: {
      id: OWNER_ID,
      fullName: 'Fixture Owner',
      phoneNumber: '+2250700003211',
      phoneVerifiedAt: JAN,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
      registeredAt: JAN,
      preferredLanguage: 'FR',
    },
  });
  await prisma.$transaction(async (tx) => {
    await tx.organization.createMany({
      data: [
        { id: ORG_ID, name: 'Fixture Business' },
        { id: OTHER_ORG_ID, name: 'Fixture Other Business' },
      ],
    });
    await tx.collaboration.createMany({
      data: [
        {
          id: '0199c032-0000-7000-8000-000000000031',
          personId: OWNER_ID,
          organizationId: ORG_ID,
          role: 'OWNER',
          status: 'ACTIVE',
        },
        {
          id: '0199c032-0000-7000-8000-000000000032',
          personId: OWNER_ID,
          organizationId: OTHER_ORG_ID,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      ],
    });
  });
});

describe('subscription periods cannot overlap', () => {
  it('touching: stores back-to-back periods', async () => {
    await prisma.subscription.create({ data: period(FIRST_ID, JAN, FEB) });
    await prisma.subscription.create({ data: period(SECOND_ID, FEB, MAR) });
    expect(await prisma.subscription.count({ where: { organizationId: ORG_ID } })).toBe(2);
  });

  it('overlap: refuses a period starting inside another with SQLSTATE 23P01', async () => {
    await prisma.subscription.create({ data: period(FIRST_ID, JAN, FEB) });
    await expect(prisma.$executeRaw`
      INSERT INTO subscriptions (id, organization_id, plan, origin, status, price, starts_at, ends_at)
      VALUES (${SECOND_ID}::uuid, ${ORG_ID}::uuid, 'PRO', 'GIFT', 'SCHEDULED', 0, ${MID_JAN}, ${MAR})
    `).rejects.toMatchObject({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '23P01' } } },
    });
    expect(await prisma.subscription.count({ where: { organizationId: ORG_ID } })).toBe(1);
  });

  it('scope: allows other businesses and a scheduled period ended as an empty range', async () => {
    await prisma.subscription.create({ data: period(FIRST_ID, JAN, FEB) });
    await prisma.subscription.create({ data: period(SECOND_ID, JAN, FEB, OTHER_ORG_ID) });
    await prisma.subscription.create({ data: period(THIRD_ID, FEB, MAR) });
    await prisma.subscription.update({
      where: { id: THIRD_ID },
      data: { status: 'ENDED', endReason: 'UPGRADED', endsAt: FEB },
    });
    await prisma.subscription.update({
      where: { id: THIRD_ID },
      data: { startsAt: MID_JAN, endsAt: MID_JAN },
    });
    expect(await prisma.subscription.count()).toBe(3);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: THIRD_ID } })).toMatchObject({
      status: 'ENDED',
      startsAt: MID_JAN,
      endsAt: MID_JAN,
    });
  });

  it('parallel: lets only one of two overlapping transactions commit with one SQLSTATE 23P01', async () => {
    let arrived = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const results = await Promise.allSettled(
      [FIRST_ID, SECOND_ID].map((id) =>
        prisma.$transaction(async (tx) => {
          arrived += 1;
          if (arrived === 2) release();
          await ready;
          await tx.$executeRaw`
          INSERT INTO subscriptions (id, organization_id, plan, origin, status, price, starts_at, ends_at)
          VALUES (${id}::uuid, ${ORG_ID}::uuid, 'PRO', 'GIFT', 'SCHEDULED', 0, ${JAN}, ${FEB})
        `;
        })
      )
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      {
        reason: {
          code: 'P2010',
          meta: { driverAdapterError: { cause: { originalCode: '23P01' } } },
        },
      },
    ]);
    expect(await prisma.subscription.count({ where: { organizationId: ORG_ID } })).toBe(1);
  });

  it('rejects an overlapping update and rolls back all writes in that transaction', async () => {
    await prisma.subscription.create({
      data: {
        ...period(FIRST_ID, JAN, FEB),
        status: 'ENDED',
        endReason: 'EXPIRED',
      },
    });
    await prisma.subscription.create({ data: period(SECOND_ID, FEB, MAR) });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id: ORG_ID }, data: { name: 'Changed Business' } });
        await tx.$executeRaw`
        UPDATE subscriptions SET starts_at = ${MID_JAN} WHERE id = ${SECOND_ID}::uuid
      `;
      })
    ).rejects.toMatchObject({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '23P01' } } },
    });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: SECOND_ID } })).toMatchObject(
      { startsAt: FEB }
    );
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } })).toMatchObject({
      name: 'Fixture Business',
    });
  });
});
