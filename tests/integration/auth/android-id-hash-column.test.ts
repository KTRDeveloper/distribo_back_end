import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const P = '0199c039-0000-7000-8000-000000000001';
const Q = '0199c039-0000-7000-8000-000000000002';
const H = 'fingerprint-h';

async function insertDevice(id: number, personId: string, hash: string | null, revoked = false) {
  const deviceId = `0199c039-0000-7000-8000-0000000001${String(id).padStart(2, '0')}`;
  await prisma.$executeRaw`
    INSERT INTO devices (id, person_id, platform, app_version, android_id_hash, revoked_at)
    VALUES (${deviceId}::uuid, ${personId}::uuid, 'ANDROID', '1.0.0', ${hash},
      ${revoked ? new Date('2026-01-01T00:00:00.000Z') : null}::timestamptz)
  `;
  return deviceId;
}

/** Extracts the PostgreSQL code wrapped by the Prisma driver adapter. */
async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    const e = err as {
      code?: string;
      meta?: {
        code?: string;
        driverAdapterError?: { cause?: { code?: string; originalCode?: string } };
      };
    };
    const cause = e.meta?.driverAdapterError?.cause;
    return cause?.code ?? cause?.originalCode ?? e.meta?.code ?? e.code;
  }
}

beforeEach(async () => {
  await prisma.person.createMany({
    data: [
      { id: P, phoneNumber: '+2250700039001' },
      { id: Q, phoneNumber: '+2250700039002' },
    ],
  });
});

describe('devices.android_id_hash', () => {
  it('column: is a nullable text and stays empty for devices created without it', async () => {
    const [col] = await prisma.$queryRaw<Array<{ data_type: string; is_nullable: string }>>`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'devices' AND column_name = 'android_id_hash'
    `;
    expect(col).toEqual({ data_type: 'text', is_nullable: 'YES' });
    const id = await insertDevice(1, P, null);
    const [row] = await prisma.$queryRaw<Array<{ android_id_hash: string | null }>>`
      SELECT android_id_hash FROM devices WHERE id = ${id}::uuid
    `;
    expect(row.android_id_hash).toBeNull();
  });

  describe('uniqueness', () => {
    beforeEach(async () => {
      await insertDevice(1, P, H);
    });

    it('rejects a second open device of P with fingerprint H (23505)', async () => {
      expect(await code(insertDevice(2, P, H))).toBe('23505');
    });

    it('accepts a revoked device of P with fingerprint H', async () => {
      await expect(insertDevice(2, P, H, true)).resolves.toBeTruthy();
    });

    it('accepts an open device of Q with fingerprint H', async () => {
      await expect(insertDevice(2, Q, H)).resolves.toBeTruthy();
    });

    it('accepts an open device of P without fingerprint', async () => {
      await expect(insertDevice(2, P, null)).resolves.toBeTruthy();
      await expect(insertDevice(3, P, null)).resolves.toBeTruthy();
    });
  });

  it('reason: accepts REPLACED as a refresh token revocation reason', async () => {
    const deviceId = await insertDevice(1, P, null);
    const tokenId = '0199c039-0000-7000-8000-000000000201';
    await prisma.$executeRaw`
      INSERT INTO refresh_tokens (id, person_id, device_id, token_hash, expires_at, revoked_at, revoked_reason)
      VALUES (${tokenId}::uuid, ${P}::uuid, ${deviceId}::uuid, 'hash-039',
        '2027-01-01T00:00:00Z'::timestamptz, now(), 'REPLACED'::"RefreshTokenRevokedReason")
    `;
    const [row] = await prisma.$queryRaw<Array<{ revoked_reason: string }>>`
      SELECT revoked_reason::text FROM refresh_tokens WHERE id = ${tokenId}::uuid
    `;
    expect(row.revoked_reason).toBe('REPLACED');
  });

  it('raw insert: the database refuses a second open session for the same phone (AB-1)', async () => {
    await insertDevice(1, P, H);
    expect(await code(insertDevice(2, P, H))).toBe('23505');
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM devices WHERE person_id = ${P}::uuid
    `;
    expect(count).toBe(1n);
  });
});
