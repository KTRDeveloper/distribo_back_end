import { describe, expect, it } from 'vitest';
import {
  placePurchase,
  type QueuedPeriod,
} from '../../../src/modules/billing/forfait.service.js';

const NOW = new Date('2026-10-12T09:00:00Z');
const END = new Date('2026-11-12T09:00:00Z');
const QUEUED_END = new Date('2026-12-12T09:00:00Z');
const DAY = 86_400_000;
const running = (plan: QueuedPeriod['plan']): QueuedPeriod => ({
  plan,
  status: 'ACTIVE',
  startsAt: NOW,
  endsAt: END,
});

describe('placePurchase', () => {
  it('places three months at once when nothing is running', () => {
    expect(placePurchase([], null, 'ESSENTIAL', 3, NOW)).toEqual({
      placement: 'NOW', startsAt: NOW, endsAt: new Date('2027-01-12T09:00:00Z'),
    });
  });

  it.each([
    { queue: [running('ESSENTIAL')], plan: 'ESSENTIAL' as const, end: END },
    { queue: [running('PRO')], plan: 'ESSENTIAL' as const, end: END },
    {
      queue: [running('PRO'), {
        plan: 'ESSENTIAL' as const, status: 'SCHEDULED' as const,
        startsAt: END, endsAt: QUEUED_END,
      }],
      plan: 'PRO' as const, end: QUEUED_END,
    },
  ])('queues $plan behind the latest end of $queue', ({ queue, plan, end }) => {
    expect(placePurchase(queue, null, plan, 1, NOW)).toEqual({
      placement: 'QUEUED', startsAt: end,
      endsAt: new Date(end.getTime() === END.getTime()
        ? '2026-12-12T09:00:00Z' : '2027-01-12T09:00:00Z'),
    });
  });

  it.each([3, 8])('handles expiry %i days ago', (days) => {
    const expired = new Date(NOW.getTime() - days * DAY);
    const start = days < 7 ? expired : NOW;
    expect(placePurchase([], expired, 'ESSENTIAL', 1, NOW)).toEqual({
      placement: 'NOW', startsAt: start,
      endsAt: new Date(days < 7 ? '2026-11-09T09:00:00Z' : '2026-11-12T09:00:00Z'),
    });
  });

  it.each([
    { elapsed: 7 * DAY - 1, inGrace: true },
    { elapsed: 7 * DAY, inGrace: false },
  ])('applies the strict seven-day grace boundary at $elapsed ms', ({ elapsed, inGrace }) => {
    const expired = new Date(NOW.getTime() - elapsed);
    expect(placePurchase([], expired, 'ESSENTIAL', 1, NOW).startsAt)
      .toEqual(inGrace ? expired : NOW);
  });

  it('returns an upgrade from now for a higher running plan purchase', () => {
    expect(placePurchase([running('ESSENTIAL')], null, 'PRO', 1, NOW)).toEqual({
      placement: 'UPGRADE', startsAt: NOW, endsAt: END,
    });
  });
});
