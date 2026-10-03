import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { expectColumnType } from '../../helpers/db-schema';

const P = '0199c001-0000-7000-8000-000000000001';
const UNKNOWN = '0199c001-0000-7000-8000-0000000000ff';
const mobile = '+237677123456';

async function insert(v: {
  person?: string | null;
  target?: string;
  purpose?: string;
  channel?: string;
  attempts?: number;
}) {
  const person = v.person === undefined ? P : v.person;
  const target = v.target ?? mobile;
  const purpose = v.purpose ?? 'LOGIN';
  const attempts = v.attempts ?? 0;
  if (v.channel === undefined) {
    return prisma.$executeRaw`
      INSERT INTO otp_challenges (id, person_id, target, purpose, code_hash, expires_at, attempts)
      VALUES (gen_random_uuid(), ${person}::uuid, ${target}, ${purpose}::"OtpPurpose", 'hash',
              now() + interval '5 minutes', ${attempts})`;
  }
  return prisma.$executeRaw`
    INSERT INTO otp_challenges (id, person_id, target, purpose, channel, code_hash, expires_at, attempts)
    VALUES (gen_random_uuid(), ${person}::uuid, ${target}, ${purpose}::"OtpPurpose",
            ${v.channel}::"OtpChannel", 'hash', now() + interval '5 minutes', ${attempts})`;
}

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.person.deleteMany({ where: { id: P } });
  await prisma.person.create({ data: { id: P, fullName: 'Otp P', phoneNumber: '+2250700009301' } });
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.person.deleteMany({ where: { id: P } });
});

describe('otp_challenges table', () => {
  it('defaults', async () => {
    await insert({});
    const rows = await prisma.$queryRaw<
      Array<{ channel: string; attempts: number; consumed_at: Date | null; created_at: Date | null }>
    >`SELECT channel::text, attempts, consumed_at, created_at FROM otp_challenges`;
    expect(rows[0]).toMatchObject({ channel: 'SMS', attempts: 0, consumed_at: null });
    expect(rows[0]?.created_at).toBeInstanceOf(Date);
    await expectColumnType('otp_challenges', 'id', 'uuid');
    await expectColumnType('otp_challenges', 'expires_at', 'timestamptz');
    await expectColumnType('otp_challenges', 'created_at', 'timestamptz');
  });

  it('limits', async () => {
    await expect(insert({ attempts: 5 })).resolves.toBe(1);
    await expect(insert({ attempts: 6 })).rejects.toThrow(/23514|check constraint/i);
    await expect(insert({ person: null, purpose: 'REGISTRATION' })).resolves.toBe(1);
    await expect(insert({ channel: 'SMS', target: '+33612345678' })).rejects.toThrow(
      /23514|check constraint/i
    );
    await expect(insert({ channel: 'SMS', target: mobile })).resolves.toBe(1);
    await expect(insert({ channel: 'EMAIL', target: 'a@example.test' })).resolves.toBe(1);
  });

  it('enums and fk', async () => {
    await expect(insert({ purpose: 'NEW_DEVICE' })).rejects.toThrow();
    await expect(insert({ channel: 'PUSH' })).rejects.toThrow();
    await expect(insert({ person: UNKNOWN })).rejects.toThrow();
    for (const purpose of [
      'REGISTRATION',
      'LOGIN',
      'PASSWORD_RESET',
      'PHONE_CHANGE',
      'EMAIL_VERIFICATION',
      'TOTP_RECOVERY',
    ]) {
      await expect(insert({ purpose })).resolves.toBe(1);
    }
  });
});
