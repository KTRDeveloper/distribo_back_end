---
id: BIL-033
title: A payer sees the price and the start date before paying
module: billing
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [BIL-007, BIL-010, BIL-011]
read_first: [src/modules/billing/billing.routes.ts, src/modules/billing/forfait.service.ts]
design_refs: [finances/subscription/plans-on-paie-pour-son-equipe]
constraints: [C-41]
asvs: [v5.0.0-2.4.1, v5.0.0-15.3.1, v5.0.0-2.2.1]
---

# BIL-033 — A payer sees the price and the start date before paying

## Story
As a visitor, I want to see the price and the start date of the plan I choose for a business so that I know what I pay and from when it counts.

## Context
- Exists: the public router, the code rule and the rate-limit event of BIL-007; `placePurchase` (BIL-011); `priceFor` (FND-014).
- `GET /api/v1/billing/shops/{code}/quote?plan=&months=`, public. The code is read as in BIL-007. `plan` is ESSENTIAL, PRO or ENTERPRISE and `months` is 1, 3, 6 or 12; any other value or query field answers 400 `VALIDATION_ERROR`. An unknown or not ACTIVE business answers 404 `NOT_FOUND`.
- At most 60 quotes an hour per `req.ip`, counted before any read (key `billing:quote:<ip>`, provisional); the next answers 429 `RATE_LIMITED` and logs the same `warn` event as BIL-007.
- Answer 200 `{ name, plan, months, price, placement, starts_at, ends_at }`: `price` from `priceFor`; `placement`, `starts_at` and `ends_at` from `placePurchase`, with the periods read without a lock. For UPGRADE the dates are those of the purchased period alone.
- `readQueueFor(organizationId)` in `subscription.repository.ts` returns the ACTIVE and SCHEDULED periods and the `ends_at` of the latest one ended by EXPIRED.
- `C-41`: `Organization.payment_code` is unique; `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only; `plan = FREE` exactly when `plan_ends_at` is empty; a set `grace_ends_at` is after `plan_ends_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Nothing running
  Given an ACTIVE business with no period, and the clock at 2026-10-12T09:00:00Z
  When a visitor asks for ESSENTIAL, 3 months
  Then the answer is 200 with exactly the seven fields: price 15000, placement NOW, `starts_at` 2026-10-12T09:00:00Z, `ends_at` 2027-01-12T09:00:00Z, and no id, status or plan of the business
Scenario Outline: AC-2 Behind a running plan
  Given <running> running until 2026-11-01T00:00:00Z
  When a visitor asks for <asked>, 1 month
  Then the placement is <placement> and `starts_at` is <start>
  Examples:
    | running   | asked     | placement | start                |
    | PRO       | ESSENTIAL | QUEUED    | 2026-11-01T00:00:00Z |
    | ESSENTIAL | ESSENTIAL | QUEUED    | 2026-11-01T00:00:00Z |
    | ESSENTIAL | PRO       | UPGRADE   | the request instant  |
Scenario Outline: AC-3 The grid
  When a visitor asks for <plan>, <months> months
  Then the price is <price>
  Examples:
    | plan       | months | price  |
    | ESSENTIAL  | 1      | 5000   |
    | PRO        | 3      | 30000  |
    | ENTERPRISE | 12     | 250000 |
Scenario Outline: AC-4 Refused
  When the request is <request>
  Then the answer is <answer>
  Examples:
    | request                                   | answer                      |
    | plan FREE, months 2, or a missing value   | 400 `VALIDATION_ERROR`      |
    | an extra query field such as `price`      | 400 `VALIDATION_ERROR`      |
    | an unknown, SUSPENDED or CLOSED business  | the same 404 `NOT_FOUND`    |
```

## Abuse cases
```gherkin
Scenario: AB-1 Codes are guessed through the quote (enumeration, T6)
  When one address asks for 70 quotes of unknown well-formed codes
  Then the first 60 answers are identical 404s, the next are 429, and nothing is read after the limit
```

## Implementation
- Create: `src/modules/billing/quote.service.ts`, `tests/integration/billing/shop-quote.test.ts`
- Modify: `src/modules/billing/billing.routes.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`, `src/modules/billing/subscription.repository.ts`
- Pattern: `tests/integration/auth/register-request.test.ts`
- Signatures:
  - `quoteFor(input: { code: string; plan: PaidPlanCode; months: PackMonths; ip: string; now: Date }): Promise<Quote>`
  - `readQueueFor(organizationId: string): Promise<{ queue: QueuedPeriod[]; lastExpiredEndsAt: Date | null }>`
- Types:
  - `Quote = { name: string; plan: PaidPlanCode; months: PackMonths; price: bigint; placement: 'NOW' | 'QUEUED' | 'UPGRADE'; startsAt: Date; endsAt: Date }`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `RATE_LIMITED` 429
- Dependencies: `zod`, `express`

## Security
- v5.0.0-2.4.1: quotes are limited per address before any read.
- v5.0.0-15.3.1: the answer lists its seven fields one by one.
- v5.0.0-2.2.1: plan and months are closed lists, and the price is the server's.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| nothing running | integration | AC-1, C-41 | 200, seven keys, price, NOW, dates |
| behind | integration | AC-2 | each Examples row → placement, start |
| grid | integration | AC-3 | each Examples row → price |
| refused | integration | AC-4 | each Examples row → answer |
| guessing | security | AB-1, CWE-307 | 70 unknown codes → 60 identical 404s then 429 |

Command: `npx vitest run tests/integration/billing/shop-quote.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the quote path | add GET /api/v1/billing/shops/{code}/quote, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the quote path | add GET /api/v1/billing/shops/{code}/quote, remove nothing |

## Out of scope
- Creating the payment: BIL-009.
