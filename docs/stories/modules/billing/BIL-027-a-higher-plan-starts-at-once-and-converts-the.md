---
id: BIL-027
title: A higher plan starts at once and converts the days left
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-011]
read_first: [src/modules/billing/forfait.service.ts, src/modules/billing/plan-math.ts]
design_refs: [finances/subscription]
constraints: [C-52]
asvs: [v5.0.0-2.3.3, v5.0.0-2.2.1]
---

# BIL-027 — A higher plan starts at once and converts the days left

## Story
Technical story: let a purchase of a higher plan start at once, turn the days left of the lower plan into days of the new one and end the periods it replaces, so that nothing paid for is lost.

## Context
- Exists: `startOrQueueForfait`, the repository (BIL-011); `convertRemainingDays` (BIL-010).
- New `upgrade.service.ts` with `addPaidForfait(tx, purchase)`, the one entry point for a paid period: it locks, and when the running period is of a lower plan than the purchase it upgrades, else it calls `startOrQueueForfait`.
- Upgrade, in this order:
  - Days left: for the ACTIVE period `ends_at - now` (0 if past), for each SCHEDULED one `ends_at - starts_at`, each with its own plan; `convertRemainingDays(parts, plan)` gives the converted days.
  - End the ACTIVE period (`ends_at = now`) and each SCHEDULED one (`ends_at = starts_at`), ENDED with `end_reason` UPGRADED, one FORFAIT_ENDED event each.
  - Insert the purchased period ACTIVE from `now` (as in BIL-011) with a FORFAIT_ADDED event; then, if converted days is above 0, a CONVERSION period: SCHEDULED, same plan, price 0, no payment or months, from the purchased `ends_at` for the converted days, with a FORFAIT_ADDED event.
  - One PLAN_CHANGED event (details: from, to).
- Returns `{ purchased, conversion, endedIds }`. `repository.endPeriod` is added.
- `C-52`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); periods of one organization never overlap (exclusion constraint); `starts_at` is not after `ends_at`; `payment_id` and `months` are set exactly when `origin = PAYMENT`; `end_reason` is set exactly when `status = ENDED`; only the server writes it.

## Acceptance criteria
```gherkin
Scenario: AC-1 Upgrade
  Given ESSENTIAL running with 20 days left
  When PRO for 1 month is placed
  Then the ESSENTIAL period is ENDED UPGRADED with `ends_at = now`, PRO is ACTIVE from `now` for a month, and a CONVERSION period of PRO lasting 10 days is SCHEDULED after it, price 0
Scenario: AC-2 Scheduled periods are converted too
  Given ESSENTIAL running with 20 days left and an ESSENTIAL period of 31 days SCHEDULED after it
  When PRO for 1 month is placed
  Then both ESSENTIAL periods are ENDED UPGRADED, the scheduled one with `ends_at = starts_at`, and the CONVERSION lasts 26 days
Scenario: AC-3 Nothing left
  Given an ACTIVE ESSENTIAL period whose `ends_at` is already past
  When PRO is placed
  Then no CONVERSION period is created
Scenario Outline: AC-4 One entry point
  When `addPaidForfait` runs with <running> running and <bought> bought
  Then the result is <result>
  Examples:
    | running    | bought     | result                  |
    | nothing    | PRO        | ACTIVE from now         |
    | PRO        | ESSENTIAL  | SCHEDULED               |
    | ESSENTIAL  | ESSENTIAL  | SCHEDULED               |
    | ESSENTIAL  | ENTERPRISE | upgrade                 |
Scenario: AC-5 The journal
  When AC-2 runs
  Then there are 2 FORFAIT_ENDED, 2 FORFAIT_ADDED and 1 PLAN_CHANGED events for the business
```

## Abuse cases
```gherkin
Scenario: AB-1 The same payment is applied twice (replay, T3)
  When `addPaidForfait` runs twice with one payment id
  Then the second call fails on the unique payment, and the periods are as the first call left them
```

## Implementation
- Create: `src/modules/billing/upgrade.service.ts`, `tests/integration/billing/upgrade.test.ts`
- Modify: `src/modules/billing/subscription.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `addPaidForfait(tx: Prisma.TransactionClient, purchase: ForfaitPurchase): Promise<AddedForfait>`
  - `endPeriod(tx: Prisma.TransactionClient, id: string, endsAt: Date, reason: 'EXPIRED' | 'UPGRADED' | 'CLOSED' | 'REFUNDED'): Promise<void>`
- Types:
  - `AddedForfait = { purchased: PeriodRow; conversion: PeriodRow | null; endedIds: string[] }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: ending, inserting and journalling run in the caller's transaction.
- v5.0.0-2.2.1: the price and months come from the caller's purchase; no value read from a request reaches the dates.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| upgrade | integration | AC-1, C-52 | ESSENTIAL 20 days → PRO and 10 days converted |
| scheduled | integration | AC-2 | 20 + 31 days → 26 days, absorbed rows |
| nothing left | integration | AC-3 | lapsed period → no conversion |
| entry point | integration | AC-4 | each Examples row → result |
| journal | integration | AC-5 | event counts |
| replay | security | AB-1, CWE-294 | same payment twice → second fails, rows unchanged |

Command: `npx vitest run tests/integration/billing/upgrade.test.ts tests/integration/billing/forfait-queue.test.ts`

## Out of scope
- Receipt, rights and notice for the payment: BIL-014.
