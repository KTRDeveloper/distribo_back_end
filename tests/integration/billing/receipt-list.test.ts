import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { encodeCursor } from '../../../src/shared/pagination.js';
import { nextReceiptNumber } from '../../../src/modules/billing/receipt.repository.js';
import { listReceipts } from '../../../src/modules/billing/owner-view.service.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const organizationId = newId();
const foreignOrganizationId = newId();
const ownerId = newId();
const strangerId = newId();
const roles = ['MANAGER', 'SELLER', 'DRIVER'] as const;
const members = roles.map((role) => ({ id: newId(), role }));
const issuedAt = new Date('2026-01-20T12:00:00.000Z');
const path = (id = organizationId) => `/api/v1/organizations/${id}/billing/receipts`;

type Item = {
  number: string;
  kind: 'RECEIPT' | 'CREDIT_NOTE';
  label: string;
  customer_name: string;
  customer_tax_id: string | null;
  amount_excl_tax: number;
  vat_rate_bp: number;
  vat_amount: number;
  amount: number;
  issued_at: string;
};
type Page = { items: Item[]; next_cursor: string | null };
type FixtureReceipt = { id: string; number: string; issuedAt: Date };
let receipts: FixtureReceipt[];
let foreignReceipt: FixtureReceipt;

/** Creates immutable, sequentially numbered receipt fixtures in the numbering transaction. */
async function receipt(orgId: string, date: Date, cancelsReceiptId?: string): Promise<FixtureReceipt> {
  return prisma.$transaction(async (tx) => {
    const cancelled = cancelsReceiptId
      ? await tx.subscriptionReceipt.findUniqueOrThrow({ where: { id: cancelsReceiptId } })
      : null;
    const payment = cancelled ? { id: cancelled.paymentId } : await tx.subscriptionPayment.create({
      data: {
        id: newId(), organizationId: orgId, plan: 'ESSENTIAL', months: 1,
        amount: 1190n, operator: 'MTN_MOMO', payerPhoneNumber: '+2250700006011',
        status: 'SUCCEEDED', confirmedAt: date, termsVersion: 'fixture-v1', providerReference: `fixture-${newId()}`,
      },
    });
    return tx.subscriptionReceipt.create({
      data: {
        id: newId(), number: await nextReceiptNumber(tx, date),
        kind: cancelsReceiptId ? 'CREDIT_NOTE' : 'RECEIPT', organizationId: orgId,
        paymentId: payment.id, cancelsReceiptId,
        label: 'Fixture subscription', customerName: 'Fixture Business', customerTaxId: null,
        amountExclTax: 1000n, vatRateBp: 1900, vatAmount: 190n, amount: 1190n,
        issuedAt: date,
      },
    });
  });
}

beforeEach(async () => {
  await prisma.person.createMany({
    data: [ownerId, strangerId, ...members.map((member) => member.id)].map((id, index) => ({
      id, fullName: 'Fixture Person', phoneNumber: `+22507000060${20 + index}`,
      phoneVerifiedAt: issuedAt, registeredAt: issuedAt,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    })),
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO organizations (id, name)
      VALUES (${organizationId}::uuid, 'Fixture Business'), (${foreignOrganizationId}::uuid, 'Other Fixture')`;
    await tx.collaboration.createMany({
      data: [
        { id: newId(), personId: ownerId, organizationId, role: 'OWNER', status: 'ACTIVE' },
        { id: newId(), personId: strangerId, organizationId: foreignOrganizationId, role: 'OWNER', status: 'ACTIVE' },
        ...members.map((member) => ({
          id: newId(), personId: member.id, organizationId, role: member.role, status: 'ACTIVE' as const,
        })),
      ],
    });
  });
  // Insert out of issue-date order, with a tie spanning the page boundary.
  const first = await receipt(organizationId, issuedAt);
  const oldest = await receipt(organizationId, new Date('2026-01-01T12:00:00.000Z'));
  const tied = await receipt(organizationId, issuedAt);
  const credit = await receipt(organizationId, new Date('2026-01-25T12:00:00.000Z'), first.id);
  receipts = [credit, tied, first, oldest];
  foreignReceipt = await receipt(foreignOrganizationId, issuedAt);
  await receipt(foreignOrganizationId, new Date('2026-01-26T12:00:00.000Z'));
});

describe('BIL-017 owner receipt list', () => {
  it('lists receipts and credit notes newest first, breaks ties by descending id, and scopes both pages', async () => {
    const first = await createAuthenticatedRequest(app, ownerId).get(path()).query({ limit: 2 });
    expect(first.status).toBe(200);
    const page = bodyOf<Page>(first);
    expect(page.items.map((item) => item.number)).toEqual(receipts.slice(0, 2).map((row) => row.number));
    expect(page.items[0]).toMatchObject({ kind: 'CREDIT_NOTE', amount: 1190, amount_excl_tax: 1000, vat_amount: 190 });
    expect(page.next_cursor).toEqual(expect.any(String));
    const second = await createAuthenticatedRequest(app, ownerId).get(path()).query({ limit: 2, cursor: page.next_cursor });
    expect(second.status).toBe(200);
    expect(bodyOf<Page>(second).items.map((item) => item.number)).toEqual(receipts.slice(2).map((row) => row.number));
    expect(bodyOf<Page>(second).next_cursor).toBeNull();
  });

  it('returns exactly the ten public fields with numeric amounts', async () => {
    const response = await createAuthenticatedRequest(app, ownerId).get(path()).query({ limit: 1 });
    expect(response.status).toBe(200);
    expect(bodyOf<Page>(response).items[0]).toEqual({
      number: receipts[0].number, kind: 'CREDIT_NOTE', label: 'Fixture subscription',
      customer_name: 'Fixture Business', customer_tax_id: null,
      amount_excl_tax: 1000, vat_rate_bp: 1900, vat_amount: 190, amount: 1190,
      issued_at: '2026-01-25T12:00:00.000Z',
    });
  });

  it.each([{ limit: 0 }, { limit: 101 }, { cursor: 'bad-cursor' }, { organization_id: foreignOrganizationId }])(
    'rejects invalid query %j', async (query) => {
      const response = await createAuthenticatedRequest(app, ownerId).get(path()).query(query);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    },
  );

  it.each(members)('refuses role $role', async (member) => {
    const response = await createAuthenticatedRequest(app, member.id).get(path());
    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('hides foreign organizations from both an outsider and another owner', async () => {
    for (const [personId, orgId] of [[strangerId, organizationId], [ownerId, foreignOrganizationId]]) {
      const response = await createAuthenticatedRequest(app, personId).get(path(orgId));
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
  });

  it('never returns foreign receipts when the cursor comes from another business', async () => {
    const response = await createAuthenticatedRequest(app, ownerId).get(path()).query({
      cursor: encodeCursor({ createdAt: foreignReceipt.issuedAt, id: foreignReceipt.id }),
    });
    expect(response.status).toBe(200);
    expect(bodyOf<Page>(response).items.map((item) => item.number)).toEqual(receipts.slice(1).map((row) => row.number));
  });

  it('requires authentication', async () => {
    const response = await request(app).get(path());
    expect(response.status).toBe(401);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
  });

  it('denies non-owners at the service boundary before reading receipts', async () => {
    await expect(listReceipts({
      personId: members[0].id, organizationId, role: 'MANAGER',
    }, { limit: 50 })).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('defaults to 50 items, accepts 100, and terminates an empty page', async () => {
    for (let index = 0; index < 47; index += 1) await receipt(organizationId, issuedAt);
    const response = await createAuthenticatedRequest(app, ownerId).get(path());
    expect(response.status).toBe(200);
    expect(bodyOf<Page>(response).items).toHaveLength(50);
    expect(bodyOf<Page>(response).next_cursor).toEqual(expect.any(String));
    const maximum = await createAuthenticatedRequest(app, ownerId).get(path()).query({ limit: 100 });
    expect(maximum.status).toBe(200);
    expect(bodyOf<Page>(maximum).items).toHaveLength(51);
    expect(bodyOf<Page>(maximum).next_cursor).toBeNull();
    const empty = await createAuthenticatedRequest(app, ownerId).get(path()).query({
      cursor: encodeCursor({ createdAt: new Date('2025-01-01T00:00:00.000Z'), id: newId() }),
    });
    expect(empty.status).toBe(200);
    expect(bodyOf<Page>(empty)).toEqual({ items: [], next_cursor: null });
  });
});
