import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const jobs: Array<{ channel: string; to: string; message: string; subject?: string }> = [];

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: (typeof jobs)[number]) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));

const { issueCode, verifyCode, contactCodeMessage } = await import(
  '../../../src/modules/auth/otp.service.js'
);

const ORG_A = '0199c041-0000-7000-8000-0000000000a1';
const ORG_B = '0199c041-0000-7000-8000-0000000000b1';
const PERSON_FR = '0199c041-0000-7000-8000-0000000000f1';
const PERSON_EN = '0199c041-0000-7000-8000-0000000000e1';
const CONTACT_A = '0199c041-0000-7000-8000-0000000000ca';
const CONTACT_B = '0199c041-0000-7000-8000-0000000000cb';
const PHONE = '+237677000041';

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string }) => e.code
  );
const sentCode = () => /(\d{6})/.exec(jobs[jobs.length - 1]?.message ?? '')?.[1] ?? 'x';

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges WHERE target IN (${PHONE}, 'fotso@example.com')`;
  await prisma.$executeRaw`DELETE FROM organization_contacts WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`;
  await prisma.$executeRaw`DELETE FROM people WHERE id IN (${PERSON_FR}::uuid, ${PERSON_EN}::uuid)`;
}

beforeEach(async () => {
  jobs.length = 0;
  await clean();
  await prisma.$executeRaw`
    INSERT INTO people (id, phone_number, full_name, password_hash, phone_verified_at, registered_at, preferred_language, created_at, server_updated_at)
    VALUES (${PERSON_FR}::uuid, '+237677099041', 'Fixture One', 'hash', now(), now(), 'FR'::"Language", now(), now()),
           (${PERSON_EN}::uuid, '+237677099042', 'Fixture Two', 'hash', now(), now(), 'EN'::"Language", now(), now())`;
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_A}::uuid, 'Boutique Fotso'), (${ORG_B}::uuid, 'Autre Boutique')`;
  await prisma.$executeRaw`
    INSERT INTO organization_contacts (id, organization_id, kind, slot, value, created_by_id)
    VALUES (${CONTACT_A}::uuid, ${ORG_A}::uuid, 'PHONE'::"OrganizationContactKind", 1, ${PHONE}, ${PERSON_FR}::uuid),
           (${CONTACT_B}::uuid, ${ORG_B}::uuid, 'PHONE'::"OrganizationContactKind", 1, ${PHONE}, ${PERSON_FR}::uuid)`;
});
afterAll(clean);

const issueFor = (contactId: string, over: Record<string, unknown> = {}) =>
  issueCode({
    personId: PERSON_FR,
    target: PHONE,
    purpose: 'ORG_CONTACT_VERIFICATION',
    channel: 'SMS',
    contact: { id: contactId, organizationName: 'Boutique Fotso' },
    ...over,
  });
const verifyFor = (c: string, contactId?: string, over: Record<string, unknown> = {}) =>
  verifyCode({
    target: PHONE,
    purpose: 'ORG_CONTACT_VERIFICATION',
    code: c,
    ...(contactId ? { organizationContactId: contactId } : {}),
    ...over,
  });

describe('contact code: fixed text', () => {
  it('names the business in French and English and keeps the contact id', async () => {
    const r = await issueFor(CONTACT_A);
    const c = sentCode();
    expect(c).toMatch(/^\d{6}$/);
    expect(jobs[0]?.message).toBe(
      `Code ${c}. Boutique Fotso veut afficher ce numéro comme contact sur Distribo. Ne donnez ce code que si vous acceptez.`
    );
    const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: r.challengeId } });
    expect(row.organizationContactId).toBe(CONTACT_A);

    jobs.length = 0;
    await issueFor(CONTACT_A, { personId: PERSON_EN });
    expect(jobs[0]?.message).toBe(
      `Code ${sentCode()}. Boutique Fotso wants to show this number as a contact on Distribo. Only give this code if you agree.`
    );
  });

  it('says address for an email', async () => {
    await issueFor(CONTACT_A, { channel: 'EMAIL', target: 'fotso@example.com' });
    expect(jobs[0]?.message).toContain('cette adresse');
    expect(jobs[0]?.message).not.toContain('ce numéro');
    expect(contactCodeMessage('123456', 'EN', 'Shop', 'EMAIL')).toBe(
      'Code 123456. Shop wants to show this address as a contact on Distribo. Only give this code if you agree.'
    );
  });

  it('cleans the business name', () => {
    const name = `${'A'.repeat(30)}\r\n${'B'.repeat(30)}`;
    const msg = contactCodeMessage('123456', 'FR', name, 'SMS');
    // eslint-disable-next-line no-control-regex
    expect(msg).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(msg).toContain(`${'A'.repeat(30)}${'B'.repeat(10)} veut`);
    expect(msg).not.toContain('B'.repeat(11));
  });

  it('refuses a contact with another purpose, and no contact with this purpose', async () => {
    await expect(issueFor(CONTACT_A, { purpose: 'LOGIN' })).rejects.toThrow(Error);
    await expect(issueFor(CONTACT_A, { contact: undefined })).rejects.toThrow(Error);
    expect(jobs).toHaveLength(0);
    expect(await prisma.otpChallenge.count({ where: { target: PHONE } })).toBe(0);
  });
});

describe('contact code: one contact', () => {
  it('code for A is refused for B and works for A', async () => {
    await issueFor(CONTACT_A);
    const c = sentCode();
    expect(await code(verifyFor(c, CONTACT_B))).toBe('OTP_INVALID');
    expect(await code(verifyFor(c, CONTACT_A))).toBe('ok');
  });

  it('wrong pairing is refused', async () => {
    await issueFor(CONTACT_A);
    const c = sentCode();
    expect(await code(verifyFor(c))).toBe('OTP_INVALID');
    expect(await code(verifyFor(c, CONTACT_A, { purpose: 'LOGIN' }))).toBe('OTP_INVALID');
    // refused before any attempt is counted
    const row = await prisma.otpChallenge.findFirstOrThrow({ where: { target: PHONE } });
    expect(row.attempts).toBe(0);
  });

  it('AB-1 code of business A never confirms business B', async () => {
    await issueFor(CONTACT_A);
    const c = sentCode();
    expect(await code(verifyFor(c, CONTACT_B))).toBe('OTP_INVALID');
    const b = await prisma.organizationContact.findUniqueOrThrow({ where: { id: CONTACT_B } });
    expect(b.verifiedAt).toBeNull();
    const row = await prisma.otpChallenge.findFirstOrThrow({ where: { target: PHONE } });
    expect(row.consumedAt).toBeNull();
    expect(row.attempts).toBe(0);
  });
});
