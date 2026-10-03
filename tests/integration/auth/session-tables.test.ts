import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { expectColumnType } from '../../helpers/db-schema';

const P = '0199c007-0000-7000-8000-000000000001';
const D = '0199c007-0000-7000-8000-0000000000d1';
const UNKNOWN = '0199c007-0000-7000-8000-0000000000ff';

async function device(platform = 'ANDROID', person = P, id = D) {
  return prisma.$executeRaw`
    INSERT INTO devices (id, person_id, platform, app_version)
    VALUES (${id}::uuid, ${person}::uuid, ${platform}::"DevicePlatform", '1.0.0')`;
}

async function token(v: { hash?: string; at?: boolean; reason?: string | null; person?: string; dev?: string }) {
  const at = v.at ? new Date() : null;
  const reason = v.reason ?? null;
  return prisma.$executeRaw`
    INSERT INTO refresh_tokens (id, person_id, device_id, token_hash, expires_at, revoked_at, revoked_reason)
    VALUES (gen_random_uuid(), ${v.person ?? P}::uuid, ${v.dev ?? D}::uuid, ${v.hash ?? 'h1'},
            now() + interval '90 days', ${at}::timestamptz, ${reason}::"RefreshTokenRevokedReason")`;
}

async function clean() {
  await prisma.$executeRaw`DELETE FROM refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM devices`;
  await prisma.person.deleteMany({ where: { id: P } });
}

beforeEach(async () => {
  await clean();
  await prisma.person.create({ data: { id: P, fullName: 'Sess P', phoneNumber: '+2250700009307' } });
  await device();
});

afterAll(clean);

describe('devices and refresh_tokens tables', () => {
  it('device defaults', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ scope_version_seen: number; last_synced_at: Date | null; revoked_at: Date | null; created_at: Date }>
    >`SELECT scope_version_seen, last_synced_at, revoked_at, created_at FROM devices`;
    expect(rows[0]).toMatchObject({ scope_version_seen: 0, last_synced_at: null, revoked_at: null });
    expect(rows[0]?.created_at).toBeInstanceOf(Date);
    await expectColumnType('devices', 'id', 'uuid');
    await expectColumnType('devices', 'created_at', 'timestamptz');
    await expectColumnType('refresh_tokens', 'expires_at', 'timestamptz');
  });

  it('token rules', async () => {
    await expect(token({ at: true, reason: 'LOGOUT', hash: 'a' })).resolves.toBe(1);
    await expect(token({ at: true, reason: null, hash: 'b' })).rejects.toThrow(/23514|check constraint/i);
    await expect(token({ at: false, reason: 'LOGOUT', hash: 'c' })).rejects.toThrow(/23514|check constraint/i);
    await expect(token({ hash: 'a' })).rejects.toThrow(/23505|unique/i);
    await expect(token({ at: true, reason: 'EXPIRED', hash: 'd' })).rejects.toThrow();
  });

  it('enums and keys', async () => {
    await expect(device('WINDOWS', P, UNKNOWN)).rejects.toThrow();
    await expect(device('IOS', UNKNOWN, UNKNOWN)).rejects.toThrow(/23503|foreign key/i);
    await expect(token({ person: UNKNOWN, hash: 'e' })).rejects.toThrow(/23503|foreign key/i);
    await expect(token({ dev: UNKNOWN, hash: 'f' })).rejects.toThrow(/23503|foreign key/i);
  });
});
