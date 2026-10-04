import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { addAmountHeld } from '../../../src/modules/organization/organization.repository';

const ORG_ID = '0199c006-0000-7000-8000-000000000001';
const OWNER_ID = '0199c006-0000-7000-8000-000000000011';
const STRANGER_ID = '0199c006-0000-7000-8000-000000000012';
const OWNER_COLLAB_ID = '0199c006-0000-7000-8000-000000000021';

async function readHeld(): Promise<bigint> {
  const [row] = await prisma.$queryRaw<Array<{ amount_held: bigint }>>`
    SELECT amount_held FROM collaborations WHERE id = ${OWNER_COLLAB_ID}::uuid
  `;
  return row.amount_held;
}

beforeEach(async () => {
  await prisma.person.createMany({
    data: [
      {
        id: OWNER_ID,
        fullName: 'Fixture Owner',
        phoneNumber: '+2250700006011',
        phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
        registeredAt: new Date('2026-01-01T00:00:00.000Z'),
        preferredLanguage: 'FR',
      },
      { id: STRANGER_ID, phoneNumber: '+2250700006012' },
    ],
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
    `;
    await tx.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES (${OWNER_COLLAB_ID}::uuid, ${OWNER_ID}::uuid, ${ORG_ID}::uuid, 'OWNER', 'ACTIVE')
    `;
  });
});

describe('addAmountHeld', () => {
  it('adds and subtracts', async () => {
    await prisma.$transaction(async (tx) => {
      await addAmountHeld(tx, OWNER_ID, ORG_ID, 5000n);
      await addAmountHeld(tx, OWNER_ID, ORG_ID, -2000n);
    });
    expect(await readHeld()).toBe(3000n);
  });

  it('may go negative', async () => {
    await prisma.$transaction((tx) => addAmountHeld(tx, OWNER_ID, ORG_ID, -700n));
    expect(await readHeld()).toBe(-700n);
  });

  it('loses no update when 20 transactions add in parallel', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction((tx) => addAmountHeld(tx, OWNER_ID, ORG_ID, 100n))
      )
    );
    expect(await readHeld()).toBe(2000n);
  });

  it('throws NOT_FOUND when the person is not a collaborator', async () => {
    await expect(
      prisma.$transaction((tx) => addAmountHeld(tx, STRANGER_ID, ORG_ID, 100n))
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(await readHeld()).toBe(0n);
  });

  it('leaves amount_held unchanged when the transaction rolls back', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await addAmountHeld(tx, OWNER_ID, ORG_ID, 900n);
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect(await readHeld()).toBe(0n);
  });
});
