import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { issueReceipt } from '../../../src/modules/billing/receipt.service';
import type { ReceiptInput } from '../../../src/modules/billing/receipt.service';

const ORG_ID = '0199e012-0000-7000-8000-000000000001';
const PAYMENT_ID = '0199e012-0000-7000-8000-000000000011';
const PAYMENT_2_ID = '0199e012-0000-7000-8000-000000000012';
const NIU = 'M012345678901A';

const STARTS = new Date('2026-10-11T23:30:00Z');
const ENDS = new Date('2027-01-11T23:30:00Z');
const NOW = new Date('2026-10-12T08:00:00Z');

function input(overrides: Partial<ReceiptInput['payment']> = {}, extra: Partial<ReceiptInput> = {}) {
  return {
    payment: {
      id: PAYMENT_ID,
      organizationId: ORG_ID,
      plan: 'ESSENTIAL',
      months: 3,
      amount: 5000n,
      customerTaxId: NIU,
      ...overrides,
    },
    customerName: 'Test Shop',
    startsAt: STARTS,
    endsAt: ENDS,
    now: NOW,
    ...extra,
  } satisfies ReceiptInput;
}

type Stored = {
  number: string;
  kind: string;
  organization_id: string;
  payment_id: string;
  customer_name: string;
  customer_tax_id: string | null;
  label: string;
  amount_excl_tax: bigint;
  vat_rate_bp: number;
  vat_amount: bigint;
  amount: bigint;
  cancels_receipt_id: string | null;
};

async function stored(): Promise<Stored[]> {
  return prisma.$queryRaw<Stored[]>`
    SELECT number, kind::text AS kind, organization_id, payment_id, customer_name,
      customer_tax_id, label, amount_excl_tax, vat_rate_bp, vat_amount, amount,
      cancels_receipt_id
    FROM subscription_receipts ORDER BY number
  `;
}

beforeEach(async () => {
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
  `;
  for (const [id, ref] of [
    [PAYMENT_ID, 'REF-1'],
    [PAYMENT_2_ID, 'REF-2'],
  ]) {
    await prisma.$executeRaw`
      INSERT INTO subscription_payments (
        id, organization_id, plan, months, amount, operator, payer_phone_number,
        provider_reference, status, terms_version, customer_tax_id, confirmed_at
      ) VALUES (
        ${id}::uuid, ${ORG_ID}::uuid, 'ESSENTIAL', 3, 5000, 'MTN_MOMO', '+2250700017001',
        ${ref}, 'SUCCEEDED', '2026-10', ${NIU}, now()
      )
    `;
  }
});

describe('AC-2: a receipt', () => {
  it('stores the frozen receipt of the payment', async () => {
    const row = await prisma.$transaction((tx) => issueReceipt(tx, input()));
    expect(row.number).toBe('R-2026-000001');
    const [receipt] = await stored();
    expect(receipt).toEqual({
      number: 'R-2026-000001',
      kind: 'RECEIPT',
      organization_id: ORG_ID,
      payment_id: PAYMENT_ID,
      customer_name: 'Test Shop',
      customer_tax_id: NIU,
      label: 'Essentiel — 3 mois, du 12/10/2026 au 12/01/2027',
      amount_excl_tax: 4193n,
      vat_rate_bp: 1925,
      vat_amount: 807n,
      amount: 5000n,
      cancels_receipt_id: null,
    });
  });

  it('keeps a missing NIU null', async () => {
    await prisma.$transaction((tx) => issueReceipt(tx, input({ customerTaxId: null })));
    expect((await stored())[0].customer_tax_id).toBeNull();
  });
});

describe('AC-3: consecutive numbers', () => {
  it('numbers two receipts 000001 and 000002', async () => {
    await prisma.$transaction((tx) => issueReceipt(tx, input()));
    await prisma.$transaction((tx) => issueReceipt(tx, input({ id: PAYMENT_2_ID })));
    expect((await stored()).map((r) => r.number)).toEqual(['R-2026-000001', 'R-2026-000002']);
  });
});

describe('AC-4: label dates', () => {
  it.each([
    [
      'ESSENTIAL',
      3,
      '2026-10-11T23:30:00Z',
      '2027-01-11T23:30:00Z',
      'Essentiel — 3 mois, du 12/10/2026 au 12/01/2027',
    ],
    [
      'PRO',
      1,
      '2026-10-12T09:00:00Z',
      '2026-11-12T09:00:00Z',
      'Pro — 1 mois, du 12/10/2026 au 12/11/2026',
    ],
    [
      'ENTERPRISE',
      12,
      '2026-10-12T09:00:00Z',
      '2027-10-12T09:00:00Z',
      'Entreprise — 12 mois, du 12/10/2026 au 12/10/2027',
    ],
  ] as const)('labels %s %s months', async (plan, months, from, to, label) => {
    const row = await prisma.$transaction((tx) =>
      issueReceipt(
        tx,
        input({ plan, months }, { startsAt: new Date(from), endsAt: new Date(to) })
      )
    );
    expect(row.label).toBe(label);
  });
});

describe('AB-1: no hole in the numbers', () => {
  it('gives the number of a rolled back receipt to the next one', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const first = await issueReceipt(tx, input());
        expect(first.number).toBe('R-2026-000001');
        throw new Error('confirmation failed');
      })
    ).rejects.toThrow('confirmation failed');
    expect(await stored()).toHaveLength(0);

    const second = await prisma.$transaction((tx) => issueReceipt(tx, input()));
    expect(second.number).toBe('R-2026-000001');
  });

  it('issues distinct gap-free numbers when transactions run in parallel', async () => {
    await Promise.all(
      Array.from({ length: 2 }, (_, i) =>
        prisma.$transaction((tx) =>
          issueReceipt(tx, input({ id: i === 0 ? PAYMENT_ID : PAYMENT_2_ID }))
        )
      )
    );
    expect((await stored()).map((r) => r.number)).toEqual(['R-2026-000001', 'R-2026-000002']);
  });
});
