---
id: FND-014
title: Plan grid and business payment codes
module: foundation
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [FND-003]
read_first: [src/shared/money.ts, src/shared/ids.ts]
design_refs: [finances/subscription/plans-on-paie-pour-son-equipe, finances/subscription/prix-et-forfaits, identite-et-organisation/organization]
constraints: [C-41]
asvs: [v5.0.0-2.2.1, v5.0.0-11.5.1]
---

# FND-014 — Plan grid and business payment codes

## Story
Technical story: the server holds the plans, their limits and the price grid in one file, and draws business payment codes, so that a limit or a price is never written twice.

## Context
- Exists: money is `bigint` XAF (`src/shared/money.ts`); no plan or payment code exists.
- Plans: `FREE` (2 collaborators, 30 products, price 0), `ESSENTIAL` (5, no limit, 5 000 a month), `PRO` (10, no limit, 10 000), `ENTERPRISE` (no limit, no limit, 25 000). No limit is `null`. Limits and prices are versioned with the code.
- Price grid, for packs of 1, 3, 6 or 12 months, in XAF: ESSENTIAL 5 000, 15 000, 25 000, 50 000; PRO 10 000, 30 000, 50 000, 100 000; ENTERPRISE 25 000, 75 000, 125 000, 250 000. The server alone chooses the price; a pack keeps the price paid.
- Payment code: 8 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no `0`, `O`, `1`, `I`), drawn at random, unrelated to the name. It is not a secret (the site shows only the business name); the lookup is rate limited by IP in BIL-007.
- Adds: `src/shared/plans.ts` (no Node-only import) and `src/lib/payment-code.ts`.
- First usage: ORG-028 (code and FREE limits at creation) and BIL-009 (price of a payment). They ship here because both need them.
- `C-41`: `Organization.payment_code` is unique; `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only; `plan = FREE` exactly when `plan_ends_at` is empty; a set `grace_ends_at` is after `plan_ends_at`.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Each plan carries its limits and monthly price
  When `PLANS.<plan>` is read
  Then `maxCollaborators` is <collaborators>, `maxProducts` is <products> and `monthlyPrice` is <price>
  Examples:
    | plan | collaborators | products | price |
    | FREE | 2 | 30 | 0n |
    | ESSENTIAL | 5 | null | 5000n |
    | PRO | 10 | null | 10000n |
    | ENTERPRISE | null | null | 25000n |
Scenario Outline: AC-2 The price of a pack comes from the grid
  When `priceFor("<plan>", <months>)` is called
  Then the result is <price>
  Examples:
    | plan | months | price |
    | ESSENTIAL | 1 | 5000n |
    | ESSENTIAL | 3 | 15000n |
    | ESSENTIAL | 6 | 25000n |
    | ESSENTIAL | 12 | 50000n |
    | PRO | 1 | 10000n |
    | PRO | 3 | 30000n |
    | PRO | 6 | 50000n |
    | PRO | 12 | 100000n |
    | ENTERPRISE | 1 | 25000n |
    | ENTERPRISE | 3 | 75000n |
    | ENTERPRISE | 6 | 125000n |
    | ENTERPRISE | 12 | 250000n |
Scenario Outline: AC-3 Anything outside the grid has no price
  When `priceFor("<plan>", <months>)` is called
  Then it throws a RangeError
  Examples:
    | plan | months |
    | FREE | 1 |
    | PRO | 2 |
    | PRO | 0 |
    | GOLD | 1 |
Scenario: AC-4 A payment code has the fixed shape
  When `generatePaymentCode()` is called 1000 times
  Then every result has 8 characters, all from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`
  And no result contains `0`, `O`, `1` or `I`
  And the 1000 results are all different
Scenario: AC-5 Every symbol of the alphabet is drawn
  When 1000 payment codes are drawn
  Then each of the 32 symbols appears at least once
```

## Abuse cases
```gherkin
Scenario: AB-1 A price or a limit chosen by the caller (tampering)
  When `priceFor` receives a plan or a number of months that the grid does not list
  Then it throws a RangeError and returns no amount
```

## Implementation
- Create: `src/shared/plans.ts`, `src/lib/payment-code.ts`, `tests/unit/shared/plans.test.ts`, `tests/unit/lib/payment-code.test.ts`
- Pattern: `src/shared/ids.ts`
- Signatures:
  - `priceFor(plan: PaidPlanCode, months: PackMonths): bigint`
  - `generatePaymentCode(): string`
- Types:
  - `PlanCode = 'FREE' | 'ESSENTIAL' | 'PRO' | 'ENTERPRISE'`
  - `PaidPlanCode = Exclude<PlanCode, 'FREE'>`
  - `PackMonths = 1 | 3 | 6 | 12`
  - `PLANS: Record<PlanCode, { maxCollaborators: number | null; maxProducts: number | null; monthlyPrice: bigint }>`
  - `PACK_MONTHS: readonly PackMonths[]`
- Dependencies: none added

## Security
- v5.0.0-2.2.1: `priceFor` accepts only the pairs the grid lists and throws for any other pair.
- v5.0.0-11.5.1: the code is drawn with `crypto.randomInt`, never `Math.random`; it is an identifier, not a secret.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| plan limits | unit | AC-1, C-41 | each plan → limits and monthly price from the table |
| price grid | unit | AC-2 | each of the 12 pairs → the amount of the grid |
| no price outside the grid | security | AC-3, AB-1, CWE-472 | FREE, 2 months, 0 months, unknown plan → RangeError |
| code shape | unit | AC-4 | 1000 codes → length 8, alphabet only, no look-alike, all different |
| symbol coverage | unit | AC-5 | 1000 codes → all 32 symbols appear |

Command: `npx vitest run tests/unit/shared/plans.test.ts tests/unit/lib/payment-code.test.ts`

## Out of scope
- Storing the code or the plan on `organizations` (ORG-020) and drawing a new code after a unique violation (ORG-028).
- Reading a code typed on the site: trimming, upper-casing, checking the alphabet (BIL-007).
- Comparing plans, converting remaining days when upgrading and the discount rule (BIL-010).
