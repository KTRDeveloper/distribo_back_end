---
id: BIL-010
title: Plan arithmetic for upgrades, queues and grace
module: billing
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [FND-014]
read_first: [src/shared/plans.ts]
design_refs: [finances/subscription]
constraints: []
asvs: [v5.0.0-2.2.1]
---

# BIL-010 — Plan arithmetic for upgrades, queues and grace

## Story
Technical story: put the plan rank, the calendar-month addition and the conversion of remaining days in one pure file, so that every queue, upgrade and receipt computes dates the same way.

## Context
- Exists: `PLANS`, `priceFor`, `PaidPlanCode`, `PackMonths` (FND-014).
- New `src/modules/billing/plan-math.ts`, pure, no database:
  - `planRank(plan)`: FREE 0, ESSENTIAL 1, PRO 2, ENTERPRISE 3.
  - `addMonths(from, months)`: calendar months in UTC; a day missing from the target month becomes its last day. `addDays(from, days)`; `GRACE_DAYS = 7`.
  - `convertRemainingDays(parts, to)`: each part is `{ plan, remainingMs }` of a lower plan; it sums `remainingMs × monthlyPrice(plan) / monthlyPrice(to)` in integer arithmetic and rounds up once to whole days. 20 days of ESSENTIAL are worth 10 days of PRO.

## Acceptance criteria
```gherkin
Scenario: AC-1 Rank
  When `planRank` runs for FREE, ESSENTIAL, PRO and ENTERPRISE
  Then it returns 0, 1, 2 and 3
Scenario Outline: AC-2 Calendar months
  When `addMonths(<from>, <months>)` runs
  Then the result is <to>
  Examples:
    | from                 | months | to                   |
    | 2026-10-12T09:00:00Z | 3      | 2027-01-12T09:00:00Z |
    | 2026-11-30T09:00:00Z | 3      | 2027-02-28T09:00:00Z |
    | 2028-01-31T09:00:00Z | 1      | 2028-02-29T09:00:00Z |
    | 2026-03-31T09:00:00Z | 12     | 2027-03-31T09:00:00Z |
Scenario Outline: AC-3 Converted days
  When `convertRemainingDays` runs for <parts> to <to>
  Then the result is <days>
  Examples:
    | parts                                 | to         | days |
    | 20 days of ESSENTIAL                  | PRO        | 10   |
    | 20 days and 31 days of ESSENTIAL      | PRO        | 26   |
    | 20 days of PRO                        | ENTERPRISE | 8    |
    | 1 ms of ESSENTIAL                     | PRO        | 1    |
    | 0 ms of ESSENTIAL                     | PRO        | 0    |
Scenario Outline: AC-4 Refused input
  When `convertRemainingDays` runs for <input>
  Then it throws a RangeError
  Examples:
    | input                          |
    | a part of PRO to PRO           |
    | a part of ENTERPRISE to PRO    |
    | a negative `remainingMs`       |
Scenario: AC-5 Days
  When `addDays(2026-10-12T09:00:00Z, GRACE_DAYS)` runs
  Then the result is 2026-10-19T09:00:00Z
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/modules/billing/plan-math.ts`, `tests/unit/billing/plan-math.test.ts`
- Pattern: `tests/unit/shared/money.test.ts`
- Signatures:
  - `planRank(plan: PlanCode): 0 | 1 | 2 | 3`
  - `addMonths(from: Date, months: PackMonths): Date`
  - `addDays(from: Date, days: number): Date`
  - `convertRemainingDays(parts: ConvertPart[], to: PaidPlanCode): number`
- Types:
  - `ConvertPart = { plan: PaidPlanCode; remainingMs: number }`
  - `GRACE_DAYS = 7`
- Dependencies: none added

## Security
- v5.0.0-2.2.1: a part that is not of a lower plan, or has a negative duration, throws instead of giving days.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| rank | unit | AC-1 | four plans → 0 to 3 |
| months | unit | AC-2 | each Examples row → date |
| conversion | unit | AC-3 | each Examples row → days |
| refused | unit | AC-4 | each Examples row → RangeError |
| days | unit | AC-5 | seven days added |

Command: `npx vitest run tests/unit/billing/plan-math.test.ts`

## Out of scope
- Choosing start dates and queue order: BIL-011 and BIL-027.
