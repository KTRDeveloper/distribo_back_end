import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import client from 'prom-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/lib/logger';
import { runReconcileJob } from '../../../src/jobs/reconcile';
import { reconcile } from '../../../src/modules/finance/reconcile.service';
import { appendLedgerEntry, reverseLedgerEntry } from '../../../src/modules/finance/ledger.service';
import {
  cancelExpenseInTx,
  cancelHandoverInTx,
  recordExpenseInTx,
  recordHandoverInTx,
} from '../../../src/modules/finance/held-money';
import { prisma } from '../../setup';

const ORG_ID = '0199c018-0000-7000-8000-000000000001';
const OWNER_ID = '0199c018-0000-7000-8000-000000000011';
const MANAGER_ID = '0199c018-0000-7000-8000-000000000012';
const CUSTOMER_ID = '0199c018-0000-7000-8000-000000000013';
const CUSTOMER_2_ID = '0199c018-0000-7000-8000-000000000014';
const OWNER_ROW = '0199c018-0000-7000-8000-000000000031';
const MANAGER_ROW = '0199c018-0000-7000-8000-000000000032';
const REL_ID = '0199c018-0000-7000-8000-000000000021';
const REL_2_ID = '0199c018-0000-7000-8000-000000000022';

const AT = new Date('2026-10-01T10:00:00.000Z');
const SCRIPT_TIMEOUT = 60_000;

let sequence = 0;
/** Returns a fresh UUIDv7-shaped id for a row of the fixture. */
function nextId(): string {
  sequence += 1;
  return `0199c018-0000-7000-8000-${String(1000 + sequence).padStart(12, '0')}`;
}

function entry(
  kind: 'PAYMENT' | 'REFUND' | 'OPENING_BALANCE',
  amount: bigint,
  recordedById: string,
  relationshipId = REL_ID
) {
  return {
    id: nextId(),
    relationshipId,
    kind,
    amount,
    mode: kind === 'OPENING_BALANCE' ? undefined : ('CASH' as const),
    recordedById,
    organizationId: ORG_ID,
    occurredAt: AT,
  };
}

async function held(personId: string): Promise<bigint> {
  return (
    await prisma.collaboration.findFirstOrThrow({ where: { personId, organizationId: ORG_ID } })
  ).amountHeld;
}

beforeEach(async () => {
  sequence = 0;
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700018011', ...registered },
      { id: MANAGER_ID, fullName: 'Fixture Manager', phoneNumber: '+2250700018012', ...registered },
      { id: CUSTOMER_ID, fullName: 'Fixture Client', phoneNumber: '+2250700018013', ...registered },
      {
        id: CUSTOMER_2_ID,
        fullName: 'Fixture Client 2',
        phoneNumber: '+2250700018014',
        ...registered,
      },
    ],
  });
  await prisma.organization.create({ data: { id: ORG_ID, name: 'Fixture Supplier' } });
  await prisma.collaboration.createMany({
    data: [
      {
        id: OWNER_ROW,
        personId: OWNER_ID,
        organizationId: ORG_ID,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      {
        id: MANAGER_ROW,
        personId: MANAGER_ID,
        organizationId: ORG_ID,
        role: 'MANAGER',
        status: 'ACTIVE',
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid),
           (${REL_2_ID}::uuid, ${ORG_ID}::uuid, ${CUSTOMER_2_ID}::uuid, ${OWNER_ID}::uuid)
  `;
});

/** Builds consistent data through the real services: every kind of entry and movement. */
async function seedBusiness(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await appendLedgerEntry(tx, entry('OPENING_BALANCE', 40_000n, OWNER_ID));
    await appendLedgerEntry(tx, entry('PAYMENT', 10_000n, MANAGER_ID));
    const reversed = await appendLedgerEntry(tx, entry('PAYMENT', 5_000n, MANAGER_ID));
    await reverseLedgerEntry(tx, reversed.id, {
      id: nextId(),
      recordedById: OWNER_ID,
      heldById: MANAGER_ID,
    });
    await appendLedgerEntry(tx, entry('REFUND', 2_000n, MANAGER_ID));
    await appendLedgerEntry(tx, entry('PAYMENT', 1_200n, OWNER_ID, REL_2_ID));

    const live = {
      organizationId: ORG_ID,
      paidById: MANAGER_ID,
      recordedById: MANAGER_ID,
      occurredAt: AT,
    };
    await recordExpenseInTx(tx, { ...live, id: nextId(), amount: 1_500n });
    const cancelledExpense = await recordExpenseInTx(tx, { ...live, id: nextId(), amount: 700n });
    await cancelExpenseInTx(tx, {
      expenseId: cancelledExpense.id,
      organizationId: ORG_ID,
      cancelledById: OWNER_ID,
    });

    const handover = { organizationId: ORG_ID, occurredAt: AT };
    await recordHandoverInTx(tx, {
      ...handover,
      id: nextId(),
      fromPersonId: MANAGER_ID,
      toPersonId: OWNER_ID,
      amount: 3_000n,
    });
    const cancelledHandover = await recordHandoverInTx(tx, {
      ...handover,
      id: nextId(),
      fromPersonId: MANAGER_ID,
      toPersonId: OWNER_ID,
      amount: 400n,
    });
    await cancelHandoverInTx(tx, {
      handoverId: cancelledHandover.id,
      organizationId: ORG_ID,
      cancelledById: OWNER_ID,
    });
    await recordHandoverInTx(tx, {
      ...handover,
      id: nextId(),
      fromPersonId: OWNER_ID,
      toPersonId: OWNER_ID,
      amount: 500n,
    });
  });
}

describe('reconcile (FIN-018)', () => {
  it('AC-1 clean: no data and consistent data report 0 mismatches', async () => {
    expect(await reconcile()).toEqual({ balanceMismatches: [], heldMismatches: [] });
    await seedBusiness();
    expect(await reconcile()).toEqual({ balanceMismatches: [], heldMismatches: [] });
  });

  it('AC-2 balance drift: a cache off by 1 franc is reported with the relationship id', async () => {
    await seedBusiness();
    const before = (await prisma.customerRelationship.findUniqueOrThrow({ where: { id: REL_ID } }))
      .balance;
    await prisma.$executeRaw`UPDATE customer_relationships SET balance = balance + 1 WHERE id = ${REL_ID}::uuid`;

    const result = await reconcile();

    expect(result.heldMismatches).toEqual([]);
    expect(result.balanceMismatches).toEqual([
      { id: REL_ID, expected: before.toString(), actual: (before + 1n).toString() },
    ]);
  });

  it('AC-3 held drift: an amount_held changed directly is reported', async () => {
    await seedBusiness();
    const before = await held(MANAGER_ID);
    await prisma.$executeRaw`UPDATE collaborations SET amount_held = amount_held - 250 WHERE id = ${MANAGER_ROW}::uuid`;

    const result = await reconcile();

    expect(result.balanceMismatches).toEqual([]);
    expect(result.heldMismatches).toEqual([
      { id: MANAGER_ROW, expected: before.toString(), actual: (before - 250n).toString() },
    ]);
  });

  it('AC-4 full formula: expected held money follows the stated rules and matches the caches', async () => {
    await seedBusiness();

    // Manager: payments 10000 (+5000 reversed) - refund 2000 - live expense 1500 - handover 3000.
    expect(await held(MANAGER_ID)).toBe(3_500n);
    // Owner: payment 1200, + handover received 3000, - automatic self handover 500.
    expect(await held(OWNER_ID)).toBe(3_700n);
    expect(await reconcile()).toEqual({ balanceMismatches: [], heldMismatches: [] });

    // The formula itself, not the caches, decides: zeroing both caches yields two mismatches
    // whose expected values are the figures above.
    await prisma.$executeRaw`UPDATE collaborations SET amount_held = 0`;
    const { heldMismatches } = await reconcile();
    expect(heldMismatches).toHaveLength(2);
    expect(heldMismatches).toContainEqual({ id: MANAGER_ROW, expected: '3500', actual: '0' });
    expect(heldMismatches).toContainEqual({ id: OWNER_ROW, expected: '3700', actual: '0' });
  });

  it('ignores deleted relationships for the balance check', async () => {
    await seedBusiness();
    await prisma.$executeRaw`UPDATE customer_relationships SET balance = balance + 7, deleted_at = now() WHERE id = ${REL_2_ID}::uuid`;

    expect((await reconcile()).balanceMismatches).toEqual([]);
  });

  it('logs each mismatch at error with a fixed event and ids, and counts it', async () => {
    await seedBusiness();
    await prisma.$executeRaw`UPDATE customer_relationships SET balance = balance + 1 WHERE id = ${REL_ID}::uuid`;
    await prisma.$executeRaw`UPDATE collaborations SET amount_held = amount_held + 5 WHERE id = ${OWNER_ROW}::uuid`;
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const counter = (event: string) =>
      client.register
        .getSingleMetric('reconcile_mismatch_total')
        ?.get()
        .then((m) => m.values.find((v) => v.labels.event === event)?.value ?? 0);
    const countersBefore = [
      await counter('balance_mismatch'),
      await counter('amount_held_mismatch'),
    ];

    const code = await runReconcileJob();

    expect(code).toBe(1);
    const events = spy.mock.calls.map(([payload]) => payload as Record<string, unknown>);
    expect(events).toHaveLength(2);
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'balance_mismatch', id: REL_ID })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'amount_held_mismatch', id: OWNER_ROW })
    );
    expect(JSON.stringify(events)).not.toContain('Fixture');
    expect(await counter('balance_mismatch')).toBe((countersBefore[0] ?? 0) + 1);
    expect(await counter('amount_held_mismatch')).toBe((countersBefore[1] ?? 0) + 1);
    spy.mockRestore();
  });

  function runScript(): number | null {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/jobs/reconcile.ts'], {
      cwd: resolve(__dirname, '../../..'),
      env: { ...process.env, LOG_LEVEL: 'fatal' },
      encoding: 'utf-8',
    });
    return result.status;
  }

  it(
    'AC-5 exit code: the script exits 1 on a mismatch and 0 otherwise',
    () => {
      return (async () => {
        await seedBusiness();
        expect(runScript()).toBe(0);
        await prisma.$executeRaw`UPDATE customer_relationships SET balance = balance + 1 WHERE id = ${REL_ID}::uuid`;
        expect(runScript()).toBe(1);
      })();
    },
    SCRIPT_TIMEOUT
  );
});
