---
id: BIL-011
title: A purchased period starts at once or joins the queue
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-002, BIL-004, BIL-032, BIL-010]
read_first: [src/modules/billing/plan-math.ts]
design_refs: [finances/subscription]
constraints: [C-52]
asvs: [v5.0.0-2.3.3]
---

# BIL-011 — A purchased period starts at once or joins the queue

## Story
Technical story: give billing the function that places a purchased period for a business, now or after the ones already bought, so that no day paid for is lost or counted twice.

## Context
- Exists: `subscriptions`, `subscription_events`, no overlap (BIL-032); `addMonths`, `planRank`, `GRACE_DAYS` (BIL-010).
- New `subscription.repository.ts` (the only file reading or writing these tables): `lockSubscriptions(tx, organizationId)` (transaction advisory lock), `listQueue` (ACTIVE and SCHEDULED, by `starts_at`), `findLastExpired` (ENDED with `end_reason` EXPIRED, latest `ends_at`), `insertPeriod`, `insertEvent`, `runInTransaction(work)`.
- New `forfait.service.ts`, first a pure `placePurchase(queue, lastExpiredEndsAt, plan, months, now)` that returns `{ placement, startsAt, endsAt }` (the quote reuses it, BIL-033):
  - empty queue, last period expired less than 7 days before `now`: NOW from that `ends_at` (a purchase in grace starts at the due date);
  - empty queue otherwise: NOW from `now`;
  - running plan of the same or a higher rank: QUEUED from the latest `ends_at` of the queue;
  - running plan lower than the purchase: UPGRADE from `now` (BIL-027).
  `endsAt` = `addMonths(startsAt, months)`.
- Then `startOrQueueForfait(tx, purchase)`, purchase = organization, plan, months, price, payment id, actor (PAYER, or ADMINISTRATOR with its ids), `now`. It locks, reads the queue, calls `placePurchase`, and for UPGRADE throws `UpgradeRequiredError` with nothing written. Else it inserts the period (origin PAYMENT, ACTIVE for NOW, SCHEDULED for QUEUED), writes one FORFAIT_ADDED event (details: plan, months, status) and returns the period.
- `C-52`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); periods of one organization never overlap (exclusion constraint); `starts_at` is not after `ends_at`; `payment_id` and `months` are set exactly when `origin = PAYMENT`; `end_reason` is set exactly when `status = ENDED`; only the server writes it.

## Acceptance criteria
```gherkin
Scenario: AC-1 Nothing running
  When ESSENTIAL for 3 months is placed at 2026-10-12T09:00:00Z with an empty queue
  Then the period is ACTIVE from that instant to 2027-01-12T09:00:00Z
Scenario Outline: AC-2 Behind the queue
  Given <queue>
  When <bought> for 1 month is placed
  Then it is SCHEDULED, starting when <after> ends
  Examples:
    | queue                                | bought    | after                    |
    | ESSENTIAL running                    | ESSENTIAL | the running period       |
    | PRO running                          | ESSENTIAL | the running period       |
    | PRO running, ESSENTIAL scheduled     | PRO       | the scheduled period     |
Scenario Outline: AC-3 Grace
  Given the last period expired <ago> before `now` and nothing else
  When ESSENTIAL for 1 month is placed
  Then it is ACTIVE from <start>
  Examples:
    | ago     | start              |
    | 3 days  | that period's end  |
    | 8 days  | `now`              |
Scenario: AC-4 A higher plan
  When PRO is placed while ESSENTIAL is running
  Then it throws `UpgradeRequiredError` and no period or event is written
Scenario: AC-5 The journal
  When a period is placed for a payer
  Then one FORFAIT_ADDED event exists with actor PAYER, the payment id and the period id
```

## Abuse cases
```gherkin
Scenario: AB-1 Two payments for one business at the same time (race, T3)
  When two transactions place ESSENTIAL for 1 month at once
  Then one period is ACTIVE and the other SCHEDULED from its end, with no overlap error
```

## Implementation
- Create: `src/modules/billing/subscription.repository.ts`, `src/modules/billing/forfait.service.ts`, `tests/integration/billing/forfait-queue.test.ts`, `tests/unit/billing/place-purchase.test.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `placePurchase(queue: QueuedPeriod[], lastExpiredEndsAt: Date | null, plan: PaidPlanCode, months: PackMonths, now: Date): Placement`
  - `startOrQueueForfait(tx: Prisma.TransactionClient, purchase: ForfaitPurchase): Promise<PeriodRow>`
- Types:
  - `Placement = { placement: 'NOW' | 'QUEUED' | 'UPGRADE'; startsAt: Date; endsAt: Date }`
  - `QueuedPeriod = { plan: PaidPlanCode; status: 'ACTIVE' | 'SCHEDULED'; startsAt: Date; endsAt: Date }`
  - `ForfaitPurchase = { organizationId: string; plan: PaidPlanCode; months: PackMonths; price: bigint; paymentId: string; actor: ForfaitActor; now: Date }`
  - `ForfaitActor = { actor: 'PAYER' } | { actor: 'ADMINISTRATOR'; administratorId: string; adminActionId: string }`
- Errors: `UpgradeRequiredError` (plain Error subclass)
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: the lock, the period and the event belong to the caller's transaction, so all succeed or none.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| at once | integration | AC-1, C-52 | empty queue → ACTIVE, end date |
| queue | integration | AC-2 | each Examples row → SCHEDULED from that end |
| grace | integration | AC-3 | each Examples row → start |
| upgrade needed | integration | AC-4 | higher plan → error, no rows |
| journal | integration | AC-5 | FORFAIT_ADDED with ids |
| pure placement | unit | AC-1, AC-2, AC-3 | same cases without a database → placement, dates |
| race | security | AB-1, CWE-362 | two parallel placements → ACTIVE and SCHEDULED, no overlap |

Command: `npx vitest run tests/integration/billing/forfait-queue.test.ts tests/unit/billing/place-purchase.test.ts`

## Out of scope
- Upgrade with conversion: BIL-027. Ending periods: BIL-028.
