import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import {
  findActiveOwnerId,
  findOrganizationByPaymentCode,
  findOrganizationSummary,
} from '../../../src/modules/organization/organization.repository';

const ORG_ID = '0199c044-0000-7000-8000-000000000001';
const DELETED_ORG_ID = '0199c044-0000-7000-8000-000000000002';
const OWNER_ID = '0199c044-0000-7000-8000-000000000011';
const MANAGER_ID = '0199c044-0000-7000-8000-000000000012';
const CODE = 'AB12CD34';
const DELETED_CODE = 'ZY98XW76';

function registeredPerson(id: string, phoneNumber: string) {
  return {
    id,
    fullName: 'Fixture Person',
    phoneNumber,
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
}

beforeEach(async () => {
  await prisma.person.createMany({
    data: [
      registeredPerson(OWNER_ID, '+2250700044011'),
      registeredPerson(MANAGER_ID, '+2250700044012'),
    ],
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO organizations (id, name, payment_code, status)
      VALUES (${ORG_ID}::uuid, 'Fixture Business', ${CODE}, 'SUSPENDED')
    `;
    await tx.$executeRaw`
      INSERT INTO organizations (id, name, payment_code, deleted_at)
      VALUES (${DELETED_ORG_ID}::uuid, 'Deleted Business', ${DELETED_CODE}, now())
    `;
    await tx.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES
        ('0199c044-0000-7000-8000-000000000021'::uuid, ${MANAGER_ID}::uuid, ${ORG_ID}::uuid, 'MANAGER', 'ACTIVE'),
        ('0199c044-0000-7000-8000-000000000022'::uuid, ${OWNER_ID}::uuid, ${ORG_ID}::uuid, 'OWNER', 'ACTIVE')
    `;
  });
});

describe('findOrganizationByPaymentCode', () => {
  it('found: the exact code returns id, name and status only', async () => {
    const found = await findOrganizationByPaymentCode(CODE);
    expect(found).toEqual({ id: ORG_ID, name: 'Fixture Business', status: 'SUSPENDED' });
  });

  it('found inside a transaction', async () => {
    const found = await prisma.$transaction((tx) => findOrganizationByPaymentCode(CODE, tx));
    expect(found?.id).toBe(ORG_ID);
  });

  it.each([
    ['a code that no business holds', 'NOPE0000'],
    ['the code of a deleted business', DELETED_CODE],
    ['the right code in lower case', CODE.toLowerCase()],
    ['the right code with a space around it', ` ${CODE} `],
  ])('absent: %s returns null', async (_label, code) => {
    expect(await findOrganizationByPaymentCode(code)).toBeNull();
  });
});

describe('summary and owner', () => {
  it('returns the summary and the OWNER person id, null for a deleted business', async () => {
    expect(await findOrganizationSummary(ORG_ID)).toEqual({
      id: ORG_ID,
      name: 'Fixture Business',
      status: 'SUSPENDED',
    });
    expect(await prisma.$transaction((tx) => findOrganizationSummary(ORG_ID, tx))).not.toBeNull();
    expect(await prisma.$transaction((tx) => findActiveOwnerId(tx, ORG_ID))).toBe(OWNER_ID);
    expect(await findOrganizationSummary(DELETED_ORG_ID)).toBeNull();
    expect(await findOrganizationSummary('0199c044-0000-7000-8000-0000000000ff')).toBeNull();
  });
});
