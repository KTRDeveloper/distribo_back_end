import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/lib/logger';
import { purge } from '../../../src/modules/privacy/purge.service';
import { appendLedgerEntry } from '../../../src/modules/finance/ledger.service';
import { recordExpenseInTx, recordHandoverInTx } from '../../../src/modules/finance/held-money';
import { createTotpSecret, encryptSecret } from '../../../src/lib/totp';
import { prisma } from '../../setup';

const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5434/test_db';
const SCRIPT_TIMEOUT = 60_000;
const NOW = new Date('2026-10-05T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const ORG_ID = '0199c030-0000-7000-8000-000000000001';
const PERSON_ID = '0199c030-0000-7000-8000-000000000011';
const OTHER_ID = '0199c030-0000-7000-8000-000000000012';
const CUSTOMER_ID = '0199c030-0000-7000-8000-000000000013';
const DEVICE_ID = '0199c030-0000-7000-8000-000000000021';
const REL_ID = '0199c030-0000-7000-8000-000000000031';
const ADMIN_ID = '0199c030-0000-7000-8000-000000000041';

let sequence = 0;
/** Returns a fresh UUIDv7-shaped id for a row of the fixture. */
function nextId(): string {
  sequence += 1;
  return `0199c030-0000-7000-8000-${String(1000 + sequence).padStart(12, '0')}`;
}

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);
function monthsAgo(months: number): Date {
  const date = new Date(NOW);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}

let originalMigrationUrl: string | undefined;

beforeEach(async () => {
  sequence = 0;
  originalMigrationUrl = process.env.MIGRATION_DATABASE_URL;
  process.env.MIGRATION_DATABASE_URL = TEST_DATABASE_URL;
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: PERSON_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700030011', ...registered },
      { id: OTHER_ID, fullName: 'Fixture Other', phoneNumber: '+2250700030012', ...registered },
      { id: CUSTOMER_ID, fullName: 'Fixture Client', phoneNumber: '+2250700030013', ...registered },
    ],
  });
  await prisma.organization.create({ data: { id: ORG_ID, name: 'Fixture Supplier' } });
  await prisma.collaboration.createMany({
    data: [
      {
        id: nextId(),
        personId: PERSON_ID,
        organizationId: ORG_ID,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      {
        id: nextId(),
        personId: OTHER_ID,
        organizationId: ORG_ID,
        role: 'MANAGER',
        status: 'ACTIVE',
      },
    ],
  });
  await prisma.device.create({
    data: { id: DEVICE_ID, personId: PERSON_ID, platform: 'ANDROID', appVersion: '1.0.0' },
  });
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${PERSON_ID}::uuid)
  `;
});

afterEach(() => {
  if (originalMigrationUrl === undefined) delete process.env.MIGRATION_DATABASE_URL;
  else process.env.MIGRATION_DATABASE_URL = originalMigrationUrl;
  vi.restoreAllMocks();
});

async function notification(createdAt: Date): Promise<string> {
  const id = nextId();
  await prisma.notification.create({
    data: {
      id,
      recipientId: PERSON_ID,
      content: 'Fixture notification',
      sourceEvent: 'fixture.event',
      createdAt,
    },
  });
  return id;
}

async function archive(receivedAt: Date): Promise<string> {
  const id = nextId();
  await prisma.syncArchive.create({
    data: { id, personId: PERSON_ID, deviceId: DEVICE_ID, receivedAt, changes: {} },
  });
  return id;
}

async function otp(expiresAt: Date, consumedAt: Date | null = null): Promise<string> {
  const id = nextId();
  await prisma.otpChallenge.create({
    data: {
      id,
      target: '+237600030011',
      purpose: 'LOGIN',
      channel: 'SMS',
      codeHash: 'fixture-hash',
      expiresAt,
      consumedAt,
    },
  });
  return id;
}

async function refreshToken(
  expiresAt: Date,
  revoked: { revokedAt: Date } | null = null
): Promise<string> {
  const id = nextId();
  await prisma.refreshToken.create({
    data: {
      id,
      personId: PERSON_ID,
      deviceId: DEVICE_ID,
      tokenHash: `fixture-hash-${id}`,
      expiresAt,
      ...(revoked ? { revokedAt: revoked.revokedAt, revokedReason: 'LOGOUT' as const } : {}),
    },
  });
  return id;
}

async function idempotencyKey(createdAt: Date): Promise<string> {
  const key = nextId();
  await prisma.idempotencyKey.create({ data: { personId: PERSON_ID, key, createdAt } });
  return key;
}

async function exists(table: string, id: string): Promise<boolean> {
  const rows: Array<{ n: bigint }> =
    table === 'idempotency_keys'
      ? await prisma.$queryRaw`SELECT count(*) AS n FROM idempotency_keys WHERE key = ${id}::uuid`
      : await prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM ${table} WHERE id = $1::uuid`, id);
  return Number(rows[0]?.n) === 1;
}

describe('purge (PRIV-003)', () => {
  it('AC-1 retention periods: each table keeps a row inside its period and deletes one past it', async () => {
    const rows: Array<[string, string, boolean]> = [
      ['notifications', await notification(monthsAgo(25)), true],
      ['notifications', await notification(monthsAgo(23)), false],
      ['sync_archives', await archive(daysAgo(91)), true],
      ['sync_archives', await archive(daysAgo(89)), false],
      ['otp_challenges', await otp(daysAgo(31)), true],
      ['otp_challenges', await otp(daysAgo(29)), false],
      ['otp_challenges', await otp(daysAgo(1), daysAgo(31)), true],
      ['otp_challenges', await otp(daysAgo(1), daysAgo(29)), false],
      ['refresh_tokens', await refreshToken(daysAgo(31)), true],
      ['refresh_tokens', await refreshToken(daysAgo(29)), false],
      [
        'refresh_tokens',
        await refreshToken(new Date(NOW.getTime() + 10 * DAY), { revokedAt: daysAgo(31) }),
        true,
      ],
      [
        'refresh_tokens',
        await refreshToken(new Date(NOW.getTime() + 10 * DAY), { revokedAt: daysAgo(29) }),
        false,
      ],
      ['refresh_tokens', await refreshToken(new Date(NOW.getTime() + 10 * DAY)), false],
      ['idempotency_keys', await idempotencyKey(daysAgo(31)), true],
      ['idempotency_keys', await idempotencyKey(daysAgo(29)), false],
    ];

    const counts = await purge(NOW);

    for (const [table, id, deleted] of rows) {
      expect(await exists(table, id), `${table} ${id}`).toBe(!deleted);
    }
    expect(counts).toEqual({
      notifications: 1,
      sync_archives: 1,
      otp_challenges: 2,
      refresh_tokens: 2,
      idempotency_keys: 1,
    });
  });

  async function seedCommercialHistory() {
    const old = new Date('2015-06-01T10:00:00.000Z');
    await prisma.$transaction(async (tx) => {
      await appendLedgerEntry(tx, {
        id: nextId(),
        relationshipId: REL_ID,
        kind: 'OPENING_BALANCE',
        amount: 40_000n,
        recordedById: PERSON_ID,
        organizationId: ORG_ID,
        occurredAt: old,
      });
      await appendLedgerEntry(tx, {
        id: nextId(),
        relationshipId: REL_ID,
        kind: 'PAYMENT',
        amount: 10_000n,
        mode: 'CASH',
        recordedById: OTHER_ID,
        organizationId: ORG_ID,
        occurredAt: old,
      });
      await recordExpenseInTx(tx, {
        id: nextId(),
        organizationId: ORG_ID,
        paidById: OTHER_ID,
        amount: 1_500n,
        recordedById: OTHER_ID,
        occurredAt: old,
      });
      await recordHandoverInTx(tx, {
        id: nextId(),
        organizationId: ORG_ID,
        fromPersonId: OTHER_ID,
        toPersonId: PERSON_ID,
        amount: 3_000n,
        occurredAt: old,
      });
      await tx.order.create({
        data: {
          id: nextId(),
          customerRelationshipId: REL_ID,
          placedByParty: 'SUPPLIER',
          enteredById: PERSON_ID,
          totalAmount: 0n,
          createdAt: old,
        },
      });
    });
    await prisma.administrator.create({
      data: {
        id: ADMIN_ID,
        personId: OTHER_ID,
        role: 'MODERATOR',
        totpSecret: encryptSecret(createTotpSecret().secret),
      },
    });
    await prisma.adminAction.create({
      data: {
        id: nextId(),
        administratorId: ADMIN_ID,
        action: 'SUSPEND',
        targetPersonId: PERSON_ID,
        reason: 'Fixture reason',
        occurredAt: old,
      },
    });
  }

  async function commercialSnapshot() {
    const [orders, ledger, expenses, handovers, journal, relationships] = await Promise.all([
      prisma.order.findMany({ orderBy: { id: 'asc' } }),
      prisma.ledgerEntry.findMany({ orderBy: { id: 'asc' } }),
      prisma.expense.findMany({ orderBy: { id: 'asc' } }),
      prisma.handover.findMany({ orderBy: { id: 'asc' } }),
      prisma.adminAction.findMany({ orderBy: { id: 'asc' } }),
      prisma.customerRelationship.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return { orders, ledger, expenses, handovers, journal, relationships };
  }

  it('AC-2 and AB-1 commercial kept: 11-year-old orders, ledger entries, expenses, handovers and journals are unchanged', async () => {
    await seedCommercialHistory();
    const before = await commercialSnapshot();
    expect(before.ledger).toHaveLength(2);
    expect(before.orders).toHaveLength(1);
    expect(before.expenses).toHaveLength(1);
    expect(before.handovers).toHaveLength(1);
    expect(before.journal).toHaveLength(1);

    await purge(NOW);

    expect(await commercialSnapshot()).toEqual(before);
  });

  it(
    'AC-3 migration account: the job exits 1 without deleting when MIGRATION_DATABASE_URL is missing',
    async () => {
      const id = await notification(monthsAgo(25));
      const { MIGRATION_DATABASE_URL: _unused, ...env } = process.env;
      void _unused;
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/jobs/purge.ts'], {
        cwd: resolve(__dirname, '../../..'),
        env: { ...env, LOG_LEVEL: 'fatal' },
        encoding: 'utf-8',
      });
      expect(result.status).toBe(1);
      expect(await exists('notifications', id)).toBe(true);
    },
    SCRIPT_TIMEOUT
  );

  it('AC-3 migration account: purge() itself refuses to run without it', async () => {
    const id = await notification(monthsAgo(25));
    delete process.env.MIGRATION_DATABASE_URL;
    await expect(purge(NOW)).rejects.toThrow();
    expect(await exists('notifications', id)).toBe(true);
  });

  it(
    'AC-3 migration account: the job exits 0 and deletes due rows when it is set',
    async () => {
      const old = await notification(monthsAgo(25));
      const recent = await notification(monthsAgo(1));
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/jobs/purge.ts'], {
        cwd: resolve(__dirname, '../../..'),
        env: { ...process.env, MIGRATION_DATABASE_URL: TEST_DATABASE_URL, LOG_LEVEL: 'fatal' },
        encoding: 'utf-8',
      });
      expect(result.status).toBe(0);
      expect(await exists('notifications', old)).toBe(false);
      expect(await exists('notifications', recent)).toBe(true);
    },
    SCRIPT_TIMEOUT
  );

  it('AC-4 batches: 2500 due rows are all deleted in batches and the log shows the total', async () => {
    await prisma.$executeRaw`
      INSERT INTO idempotency_keys (person_id, key, created_at)
      SELECT ${PERSON_ID}::uuid, gen_random_uuid(), ${daysAgo(40)}::timestamptz
      FROM generate_series(1, 2500)
    `;
    const spy = vi.spyOn(logger, 'info');

    const counts = await purge(NOW);

    expect(counts.idempotency_keys).toBe(2500);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    const entry = spy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((o) => o?.event === 'purge_done');
    expect(entry).toMatchObject({ event: 'purge_done', total: 2500 });
    expect((entry as { counts: Record<string, number> }).counts.idempotency_keys).toBe(2500);
  });

  it('AC-5 repeat: the second run deletes nothing', async () => {
    await notification(monthsAgo(25));
    await archive(daysAgo(91));
    await idempotencyKey(daysAgo(31));
    const first = await purge(NOW);
    expect(Object.values(first).reduce((a, b) => a + b, 0)).toBe(3);
    const second = await purge(NOW);
    expect(Object.values(second).every((n) => n === 0)).toBe(true);
    expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
  });

  it('AB-2 log content: the log holds the event, table names and counts only', async () => {
    await notification(monthsAgo(25));
    await otp(daysAgo(40));
    const spy = vi.spyOn(logger, 'info');

    await purge(NOW);

    const entries = spy.mock.calls.filter(
      (c) => (c[0] as { event?: string })?.event === 'purge_done'
    );
    expect(entries).toHaveLength(1);
    const serialized = JSON.stringify(spy.mock.calls);
    expect(serialized).not.toContain('Fixture');
    expect(serialized).not.toContain('+237600030011');
    expect(serialized).not.toContain('fixture-hash');
    const payload = entries[0]?.[0] as {
      event: string;
      counts: Record<string, unknown>;
      total: number;
    };
    expect(Object.keys(payload).sort()).toEqual(['counts', 'event', 'total']);
    for (const value of Object.values(payload.counts)) expect(typeof value).toBe('number');
  });

  it('keeps an archive that a journal entry points to, and still purges the rest', async () => {
    const referenced = await archive(daysAgo(120));
    const free = await archive(daysAgo(120));
    await prisma.administrator.create({
      data: {
        id: ADMIN_ID,
        personId: OTHER_ID,
        role: 'SUPER_ADMIN',
        totpSecret: encryptSecret(createTotpSecret().secret),
      },
    });
    await prisma.adminAction.create({
      data: {
        id: nextId(),
        administratorId: ADMIN_ID,
        action: 'REPLAY_SYNC',
        targetPersonId: PERSON_ID,
        syncArchiveId: referenced,
        reason: 'Fixture reason',
      },
    });

    const counts = await purge(NOW);

    expect(await exists('sync_archives', referenced)).toBe(true);
    expect(await exists('sync_archives', free)).toBe(false);
    expect(counts.sync_archives).toBe(1);
  });
});
