import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup.js';
import { reminderNotice } from '../../../src/modules/billing/notices.js';
import { sendDueReminders } from '../../../src/modules/billing/reminder.service.js';
import * as ownerView from '../../../src/modules/billing/owner-view.service.js';
import * as notification from '../../../src/modules/notification/notification.service.js';
import { logger } from '../../../src/lib/logger.js';
import * as organizationRepository from '../../../src/modules/organization/organization.repository.js';
import * as reminderService from '../../../src/modules/billing/reminder.service.js';
import { runSendRemindersJob } from '../../../src/jobs/send-reminders.js';

let phoneSequence = 1000000;
const END = new Date('2027-01-11T23:00:00Z');
const on = (day: number) => new Date(`2027-01-${String(day).padStart(2, '0')}T12:00:00Z`);

async function business(options: {
  language?: 'FR' | 'EN'; owner?: boolean; plan?: 'FREE' | 'ESSENTIAL' | 'PRO'; end?: Date;
} = {}) {
  const organizationId = uuidv7();
  const personId = uuidv7();
  const person: Prisma.PersonUncheckedCreateInput = { id: personId, phoneNumber: `+1202${++phoneSequence}`, preferredLanguage: options.language ?? 'EN', registeredAt: new Date('2026-01-01T00:00:00Z'), fullName: 'Reminder fixture', phoneVerifiedAt: new Date('2026-01-01T00:00:00Z'), passwordHash: 'test-only-password-hash' };
  await prisma.person.create({ data: person });
  const organization: Prisma.OrganizationUncheckedCreateInput = {
    id: organizationId, name: 'Reminder fixture', plan: options.plan ?? 'ESSENTIAL',
    planEndsAt: options.plan === 'FREE' ? null : options.end ?? END,
  };
  await prisma.organization.create({ data: organization });
  if (options.owner !== false) {
    const collaboration: Prisma.CollaborationUncheckedCreateInput = {
      id: uuidv7(), personId, organizationId, role: 'OWNER', status: 'ACTIVE',
    };
    await prisma.collaboration.create({ data: collaboration });
  }
  return { organizationId, personId };
}

async function reminders(organizationId: string) {
  return prisma.$queryRaw<Array<{ actor: string; details: { plan_ends_at: string; days_before: number } }>>`
    SELECT actor, details FROM subscription_events
    WHERE organization_id = ${organizationId}::uuid AND kind = 'REMINDER'
  `;
}

async function notices(organizationId: string) {
  return prisma.notification.findMany({ where: { organizationId, sourceEvent: 'subscription.reminder' } });
}

beforeEach(() => {
  vi.spyOn(ownerView, 'readAfterEnd').mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe('subscription reminders', () => {
  it.each([[5, 7], [11, 1], [12, 0], [8, null], [13, null]] as const)('days: January %s', async (day, daysBefore) => {
    const { organizationId, personId } = await business();
    await sendDueReminders(on(day));
    const events = await reminders(organizationId);
    expect(events).toHaveLength(daysBefore === null ? 0 : 1);
    expect(await notices(organizationId)).toHaveLength(events.length);
    if (daysBefore !== null) {
      expect(events[0]).toEqual({ actor: 'SYSTEM', details: { plan_ends_at: END.toISOString(), days_before: daysBefore } });
      expect((await notices(organizationId))[0].recipientId).toBe(personId);
    }
  });

  it('once: retries do not resend, an extension has its own reminder', async () => {
    const { organizationId } = await business();
    await sendDueReminders(on(5));
    await sendDueReminders(on(5));
    const extended = new Date('2027-04-11T23:00:00Z');
    await prisma.organization.update({ where: { id: organizationId }, data: { planEndsAt: extended } });
    await sendDueReminders(new Date('2027-04-05T12:00:00Z'));
    expect(await reminders(organizationId)).toHaveLength(2);
    expect(await notices(organizationId)).toHaveLength(2);
  });

  it.each([
    ['FR', 7, 3, 45, 'Votre forfait Essentiel se termine le 12 janvier 2027 : 3 collaborateurs et 45 produits seront mis en pause.'],
    ['EN', 7, 0, 0, 'Your Essential plan ends on January 12, 2027.'],
    ['FR', 1, 3, 0, 'Votre forfait Essentiel se termine demain.'],
    ['EN', 0, 3, 0, 'Your Essential plan ends today.'],
  ] as const)('text: %s %s days', async (language, days, collaborators, products, text) => {
    const { organizationId } = await business({ language });
    vi.mocked(ownerView.readAfterEnd).mockResolvedValue({
      plan: 'FREE', collaborators_to_pause: collaborators, products_to_pause: products,
    });
    await sendDueReminders(on(12 - days));
    expect((await notices(organizationId))[0].content).toBe(text);
  });

  it.each(['ESSENTIAL', 'PRO'] as const)('follow-up: %s', async (plan) => {
    const chainEnd = new Date('2027-04-11T23:00:00Z');
    const { organizationId } = await business({ plan, end: plan === 'ESSENTIAL' ? chainEnd : END });
    await prisma.subscription.createMany({ data: [
      { id: uuidv7(), organizationId, plan, origin: 'CONVERSION', status: 'ACTIVE',
        price: 0n, startsAt: new Date('2026-12-11T23:00:00Z'), endsAt: END },
      { id: uuidv7(), organizationId, plan: 'ESSENTIAL', origin: 'CONVERSION', status: 'SCHEDULED',
        price: 0n, startsAt: END, endsAt: chainEnd },
    ] });
    await sendDueReminders(on(5));
    expect(await reminders(organizationId)).toHaveLength(plan === 'ESSENTIAL' ? 0 : 1);
  });

  it('nobody: absent owner and FREE do not create events or notices', async () => {
    for (const fixture of [{ owner: false }, { plan: 'FREE' as const }]) {
      const { organizationId } = await business(fixture);
      await sendDueReminders(on(5));
      expect(await reminders(organizationId)).toHaveLength(0);
      expect(await notices(organizationId)).toHaveLength(0);
    }
  });

  it('broken: rolls back a failed notice, continues, logs its id and rejects', async () => {
    const broken = await business();
    const healthy = await business();
    const failure = new Error('test notice failure');
    const original = notification.notify;
    vi.spyOn(notification, 'notify').mockImplementation((input, tx) => {
      if (input.organizationId === broken.organizationId) throw failure;
      return original(input, tx);
    });
    const log = vi.spyOn(logger, 'error');
    await expect(sendDueReminders(on(5))).rejects.toBe(failure);
    expect(await reminders(broken.organizationId)).toHaveLength(0);
    expect(await notices(broken.organizationId)).toHaveLength(0);
    expect(await reminders(healthy.organizationId)).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ organizationId: broken.organizationId }), expect.any(String));
  });

  it('pages past 500 businesses and includes all of the seventh Douala day', async () => {
    const ids = Array.from({ length: 501 }, () => uuidv7());
    const listing = vi.spyOn(organizationRepository, 'listOrganizationsEnding')
      .mockResolvedValueOnce(ids.slice(0, 500)).mockResolvedValueOnce(ids.slice(500));
    vi.spyOn(organizationRepository, 'readPlanFields').mockResolvedValue(null);
    expect(await sendDueReminders(on(5))).toEqual({ checked: 501, sent: 0 });
    expect(listing).toHaveBeenNthCalledWith(1,
      new Date('2027-01-04T23:00:00Z'), new Date('2027-01-12T23:00:00Z'), 500, undefined);
    expect(listing).toHaveBeenNthCalledWith(2,
      new Date('2027-01-04T23:00:00Z'), new Date('2027-01-12T23:00:00Z'), 500, ids[499]);
  });

  it('job logs counts and returns zero; failures propagate', async () => {
    const service = vi.spyOn(reminderService, 'sendDueReminders').mockResolvedValue({ checked: 3, sent: 2 });
    const log = vi.spyOn(logger, 'info');
    expect(await runSendRemindersJob(on(5))).toBe(0);
    expect(service).toHaveBeenCalledWith(on(5));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ checked: 3, sent: 2 }), expect.any(String));
    const failure = new Error('job failed');
    service.mockRejectedValueOnce(failure);
    await expect(runSendRemindersJob(on(5))).rejects.toBe(failure);
  });

  it('concurrent repeats commit only one event and notice', async () => {
    const { organizationId } = await business();
    await Promise.all([sendDueReminders(on(5)), sendDueReminders(on(5))]);
    expect(await reminders(organizationId)).toHaveLength(1);
    expect(await notices(organizationId)).toHaveLength(1);
  });

  it('uses Douala midnight instead of the UTC day boundary', async () => {
    const { organizationId } = await business();
    await sendDueReminders(new Date('2027-01-04T22:59:59Z'));
    expect(await reminders(organizationId)).toHaveLength(0);
    await sendDueReminders(new Date('2027-01-04T23:00:00Z'));
    expect(await reminders(organizationId)).toHaveLength(1);
    expect(reminderNotice('EN', { daysBefore: 7, plan: 'ESSENTIAL', planEndsAt: END, afterEnd: null }))
      .toBe('Your Essential plan ends on January 12, 2027.');
  });
});
