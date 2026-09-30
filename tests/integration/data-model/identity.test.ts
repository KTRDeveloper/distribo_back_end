/**
 * Integration tests for the Delivery Platform Data Model — User Story 1
 * (identity, organizations and access). Automates quickstart.md check #1.
 * See specs/001-delivery-data-model/tasks.md T021.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '../../setup';
import { uniquePhone } from '../../helpers/phone';

async function createOrganization(overrides?: { ownerAccountId?: string }) {
  let ownerAccountId = overrides?.ownerAccountId;
  if (!ownerAccountId) {
    const person = await prisma.person.create({ data: { phoneNumber: uniquePhone() } });
    const account = await prisma.account.create({
      data: { personId: person.id, passwordHash: 'hash' },
    });
    ownerAccountId = account.id;
  }
  return prisma.organization.create({
    data: { type: 'BUSINESS', name: `Org ${randomUUID()}`, ownerAccountId },
  });
}

describe('Data Model: Identity, Organizations and Access (US1)', () => {
  it('rejects a duplicate Person.phoneNumber', async () => {
    const phoneNumber = uniquePhone();
    await prisma.person.create({ data: { phoneNumber } });

    await expect(prisma.person.create({ data: { phoneNumber } })).rejects.toThrow();
  });

  it('rejects a second Account for the same Person', async () => {
    const person = await prisma.person.create({ data: { phoneNumber: uniquePhone() } });
    await prisma.account.create({ data: { personId: person.id, passwordHash: 'hash-1' } });

    await expect(
      prisma.account.create({ data: { personId: person.id, passwordHash: 'hash-2' } })
    ).rejects.toThrow();
  });

  it('reuses one Person across two organizations without duplication, scoped per Customer', async () => {
    const phoneNumber = uniquePhone();
    const person = await prisma.person.create({ data: { phoneNumber } });
    const orgA = await createOrganization();
    const orgB = await createOrganization();

    const customerA = await prisma.customer.create({
      data: { personId: person.id, organizationId: orgA.id, displayLabel: 'Papa' },
    });
    const customerB = await prisma.customer.create({
      data: { personId: person.id, organizationId: orgB.id, displayLabel: 'Mamadou' },
    });

    const personCount = await prisma.person.count({ where: { phoneNumber } });
    expect(personCount).toBe(1);
    expect(customerA.displayLabel).toBe('Papa');
    expect(customerB.displayLabel).toBe('Mamadou');
    expect(customerA.organizationId).not.toBe(customerB.organizationId);
  });

  it('rejects a duplicate Customer relation for the same (personId, organizationId)', async () => {
    const person = await prisma.person.create({ data: { phoneNumber: uniquePhone() } });
    const org = await createOrganization();

    await prisma.customer.create({ data: { personId: person.id, organizationId: org.id } });

    await expect(
      prisma.customer.create({ data: { personId: person.id, organizationId: org.id } })
    ).rejects.toThrow();
  });
});
