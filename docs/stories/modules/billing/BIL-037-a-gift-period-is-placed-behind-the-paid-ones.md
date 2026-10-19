---
id: BIL-037
title: A gift period is placed behind the paid ones
module: billing
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [BIL-027]
read_first: [src/modules/billing/forfait.service.ts, src/modules/billing/subscription.repository.ts]
design_refs: [finances/subscription]
constraints: [C-52]
asvs: [v5.0.0-2.3.3]
---

# BIL-037 — A gift period is placed behind the paid ones

## Story
Technical story: give billing the function that places days offered by an administrator behind the periods already bought, so that a gift never shortens, ends or converts a paid period.

## Context
- Exists: `lockSubscriptions`, `listQueue`, `insertPeriod`, `insertEvent` (BIL-011); `addDays` (BIL-010). No route calls it yet.
- `findPeriod(tx, id)` is added to `subscription.repository.ts`: the period or null.
- `addGiftForfait(tx, gift)` in `forfait.service.ts` locks the business and reads the queue (ACTIVE and SCHEDULED). Empty queue: the period is ACTIVE from `now`. Otherwise it is SCHEDULED from the later of `now` and the latest `ends_at` of the queue: a lapsed ACTIVE period not yet ended still counts, so there is never a second ACTIVE row. `ends_at = addDays(starts_at, days)`.
- Origin GIFT, the given plan, price 0, no `months`, no payment. One FORFAIT_ADDED event: actor ADMINISTRATOR with both ids, details plan, days, status. The caller checks `days` (1 to 365) and handles a repeated `id`.
- `C-52`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); periods of one organization never overlap (exclusion constraint); `starts_at` is not after `ends_at`; `payment_id` and `months` are set exactly when `origin = PAYMENT`; `end_reason` is set exactly when `status = ENDED`; only the server writes it.

## Acceptance criteria
```gherkin
Scenario: AC-1 Nothing running
  When 30 days of PRO are placed at 2026-10-12T09:00:00Z with an empty queue
  Then the period is ACTIVE, origin GIFT, from that instant to 2026-11-11T09:00:00Z, price 0, with no `months` and no payment
Scenario: AC-2 Behind the queue
  Given ESSENTIAL ACTIVE until 2026-11-01T00:00:00Z and PRO SCHEDULED until 2026-12-01T00:00:00Z
  When 10 days of ENTERPRISE are placed
  Then the gift is SCHEDULED from 2026-12-01T00:00:00Z to 2026-12-11T00:00:00Z and the other two periods are unchanged
Scenario: AC-3 A lapsed period not yet ended
  Given an ACTIVE period whose `ends_at` passed one day ago
  When a gift is placed
  Then it is SCHEDULED from `now`, not ACTIVE
Scenario: AC-4 The journal and the lookup
  When a gift is placed
  Then one FORFAIT_ADDED event has actor ADMINISTRATOR with both ids, and `findPeriod` returns the period, or null for an unknown id
```

## Abuse cases
```gherkin
Scenario: AB-1 Two gifts at once (race, T3)
  When two transactions place a gift for one business with different ids
  Then one period is ACTIVE and the other SCHEDULED from its end, with no overlap error
```

## Implementation
- Create: `tests/integration/billing/gift-forfait.test.ts`
- Modify: `src/modules/billing/forfait.service.ts`, `src/modules/billing/subscription.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `addGiftForfait(tx: Prisma.TransactionClient, gift: GiftInput): Promise<PeriodRow>`
  - `findPeriod(tx: Prisma.TransactionClient, id: string): Promise<PeriodRow | null>`
- Types:
  - `GiftInput = { id: string; organizationId: string; plan: PaidPlanCode; days: number; actor: { administratorId: string; adminActionId: string }; now: Date }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: the lock, the period and the event belong to the caller's transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| nothing running | integration | AC-1, C-52 | ACTIVE GIFT period, dates |
| behind | integration | AC-2 | SCHEDULED after the queue, others unchanged |
| lapsed | integration | AC-3 | SCHEDULED from now |
| journal | integration | AC-4 | event fields, lookup |
| race | security | AB-1, CWE-362 | two gifts → ACTIVE and SCHEDULED, no overlap |

Command: `npx vitest run tests/integration/billing/gift-forfait.test.ts`

## Out of scope
- The route, the admin action and the notice: BIL-023.
