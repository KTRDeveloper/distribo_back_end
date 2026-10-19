---
id: BIL-028
title: A business's periods and rights follow the clock
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-013, BIL-020, BIL-027, ORG-045]
read_first: [src/modules/billing/rights.service.ts, src/modules/billing/limits.service.ts]
design_refs: [finances/subscription]
constraints: [C-52]
asvs: [v5.0.0-2.3.3, v5.0.0-8.2.2]
---

# BIL-028 — A business's periods and rights follow the clock

## Story
Technical story: give billing the function that ends the periods that ran out, starts the ones whose turn came, and refreshes the rights and the paused items of one business.

## Context
- Exists: `lockSubscriptions`, `listQueue`, `insertEvent` (BIL-011); `endPeriod` (BIL-027); `recomputeRights` (BIL-013); `enforceLimits` (BIL-020); `readPlanFields` (ORG-045).
- Why: a period row changes only when a purchase writes it, so something must make `status` and the plan columns follow the date.
- `subscription.repository.ts` gains `activatePeriod(tx, id)`: SCHEDULED becomes ACTIVE.
- `advanceSubscription(tx, organizationId, now)` in the new `advance.service.ts` locks, then walks the queue by `starts_at`:
  - an ACTIVE period with `ends_at <= now` is ended, reason EXPIRED, `ends_at` kept;
  - a SCHEDULED one with `starts_at <= now` is ended the same way when its `ends_at <= now` too, else activated;
  - each ended period writes one FORFAIT_ENDED event (actor SYSTEM, details: period id, reason).
- Then it reads the plan fields, calls `recomputeRights` and `enforceLimits`. When `plan` or `grace_ends_at` differs from before it writes one PLAN_CHANGED event (actor SYSTEM, details: from, to, `grace_ends_at`). It returns `{ ended, started, planChanged }`; an unknown or deleted business gives zeros and writes nothing.
- `C-52`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); periods of one organization never overlap (exclusion constraint); `starts_at` is not after `ends_at`; `payment_id` and `months` are set exactly when `origin = PAYMENT`; `end_reason` is set exactly when `status = ENDED`; only the server writes it.

## Acceptance criteria
```gherkin
Scenario: AC-1 A period runs out
  Given an ESSENTIAL ACTIVE period that ended 3 days ago, nothing after it, and plan columns still ESSENTIAL without grace
  When `advanceSubscription` runs
  Then the period is ENDED EXPIRED with its `ends_at` kept, one FORFAIT_ENDED event (SYSTEM) exists, `grace_ends_at` is 7 days after that end, one PLAN_CHANGED event holds the grace date, and the result is `ended` 1, `started` 0, `planChanged` true
Scenario: AC-2 The next period takes over
  Given an ESSENTIAL ACTIVE period that ended 1 hour ago and an ESSENTIAL one SCHEDULED from that instant for a month
  When `advanceSubscription` runs
  Then the first is ENDED EXPIRED, the second ACTIVE, the plan is ESSENTIAL without grace, and no PLAN_CHANGED event is written
Scenario: AC-3 A lower plan follows
  Given a PRO ACTIVE period that ended 2 days ago, an ESSENTIAL one SCHEDULED from that instant for 3 months, and 8 ACTIVE non-owner seats
  When `advanceSubscription` runs
  Then ESSENTIAL is ACTIVE, one PLAN_CHANGED event goes from PRO to ESSENTIAL, and 3 seats are paused
Scenario: AC-4 Whole periods were missed
  Given three ESSENTIAL periods in a row, the first ACTIVE and ended 40 days ago, the second ended 20 days ago, the third SCHEDULED for 3 months
  When `advanceSubscription` runs
  Then the first two are ENDED EXPIRED, the third is ACTIVE and two FORFAIT_ENDED events exist
Scenario: AC-5 The grace is over
  Given the last ESSENTIAL period ENDED EXPIRED 8 days ago, plan columns ESSENTIAL and 4 ACTIVE non-owner seats
  When `advanceSubscription` runs
  Then the business is FREE, one PLAN_CHANGED event goes from ESSENTIAL to FREE, and 2 seats are paused
Scenario Outline: AC-6 Nothing to do
  Given <state>
  When `advanceSubscription` runs
  Then no period, event or other row changes and the result is zeros
  Examples:
    | state                                           |
    | an ACTIVE period still running, rights written  |
    | a SCHEDULED period starting in the future       |
    | a deleted business                              |
```

## Abuse cases
```gherkin
Scenario: AB-1 Two runs at once (race, T3)
  When two transactions advance one business whose ACTIVE period lapsed and whose next one is due
  Then one set of events exists, one period is ACTIVE and no unique-index error escapes
```

## Implementation
- Create: `src/modules/billing/advance.service.ts`, `tests/integration/billing/advance.test.ts`
- Modify: `src/modules/billing/subscription.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `advanceSubscription(tx: Prisma.TransactionClient, organizationId: string, now: Date): Promise<AdvanceResult>`
  - `activatePeriod(tx: Prisma.TransactionClient, id: string): Promise<void>`
- Types:
  - `AdvanceResult = { ended: number; started: number; planChanged: boolean }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: ending, starting, events, rights and limits run in the caller's transaction, under the business's lock.
- v5.0.0-8.2.2: every read and write uses the organization id given by server code; no client value.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| runs out | integration | AC-1, C-52 | ended, event, grace date |
| takes over | integration | AC-2 | ACTIVE, no plan event |
| lower plan | integration | AC-3 | PRO to ESSENTIAL, 3 paused |
| missed | integration | AC-4 | two ended, one ACTIVE |
| grace over | integration | AC-5 | FREE, 2 paused |
| nothing | integration | AC-6 | each Examples row → no change |
| race | security | AB-1, CWE-362 | two parallel runs → one set of events |

Command: `npx vitest run tests/integration/billing/advance.test.ts`

## Out of scope
- The daily job and its list of businesses: BIL-039. Reminders: BIL-026.
