---
id: BIL-013
title: The server computes the rights of a business
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-011, ORG-035, FND-014]
read_first: [src/modules/billing/subscription.repository.ts, src/shared/plans.ts]
design_refs: [finances/subscription, identite-et-organisation/organization]
constraints: [C-41]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# BIL-013 — The server computes the rights of a business

## Story
Technical story: compute the plan, its end, the grace and the limits of a business from its periods and write them through the organization contract, so that the rights always match what was paid.

## Context
- Exists: the periods and their queue (BIL-011), `PLANS` (FND-014), `writePlanFields` (ORG-035).
- New `rights.service.ts`. The pure `computeRights(queue, lastExpiredEndsAt, now)` returns `OrganizationRights` (same shape as `PlanFields`); `recomputeRights(tx, organizationId, now)` locks, reads the queue, calls it, writes the result with `writePlanFields` and returns it.
- Running period: the one with `starts_at <= now < ends_at`. Its plan is the plan. `plan_ends_at` is the `ends_at` of the last period that follows it without a gap and has the same plan (a lower plan next ends the plan there, with no grace).
- No running period: if a period ended less than 7 days before `now` by running out (a lapsed ACTIVE one, or ENDED with `end_reason` EXPIRED) and nothing follows, the plan stays, `plan_ends_at` is that `ends_at` and `grace_ends_at` is 7 days later. Periods ended UPGRADED, CLOSED or REFUNDED never give grace. Otherwise FREE with no dates.
- Limits come from `PLANS[plan]`.
- `C-41`: `Organization.payment_code` is unique; `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only; `plan = FREE` exactly when `plan_ends_at` is empty; a set `grace_ends_at` is after `plan_ends_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Nothing ever bought
  When rights are recomputed for a business with no period
  Then the plan is FREE, both dates are empty, collaborators 2, products 30
Scenario: AC-2 A running plan
  Given ESSENTIAL running until D
  When rights are recomputed
  Then the plan is ESSENTIAL, `plan_ends_at` is D, no grace, collaborators 5, products no limit
Scenario: AC-3 A chain of the same plan
  Given ESSENTIAL running, then an ESSENTIAL period and a CONVERSION period, each starting where the last ends
  When rights are recomputed
  Then `plan_ends_at` is the end of the last of them
Scenario: AC-4 A lower plan next
  Given PRO running until D and ESSENTIAL scheduled from D
  When rights are recomputed before D, then after D
  Then the plan is PRO with `plan_ends_at` D and no grace, then ESSENTIAL
Scenario Outline: AC-5 After the end
  Given nothing running and the last period <last> <ago> ago
  When rights are recomputed
  Then the result is <result>
  Examples:
    | last                    | ago     | result                                              |
    | ESSENTIAL, EXPIRED      | 3 days  | ESSENTIAL, `grace_ends_at` 7 days after its end     |
    | ESSENTIAL, EXPIRED      | 8 days  | FREE, no dates                                      |
    | PRO, UPGRADED or CLOSED | 2 days  | FREE, no dates                                      |
Scenario: AC-6 The five columns only
  When rights are recomputed
  Then the five plan columns hold the result and no other column of the business changes
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's periods leak into the rights (information disclosure)
  Given business A with a PRO period and business B with none
  When rights are recomputed for B
  Then B is FREE and A's row is untouched
```

## Implementation
- Create: `src/modules/billing/rights.service.ts`, `tests/integration/billing/rights.test.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `computeRights(queue: QueuedPeriod[], lastExpiredEndsAt: Date | null, now: Date): OrganizationRights`
  - `recomputeRights(tx: Prisma.TransactionClient, organizationId: string, now: Date): Promise<OrganizationRights>`
- Types:
  - `OrganizationRights = PlanFields (ORG-035)`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: every read is bound to the organization id given by server code.
- v5.0.0-2.3.3: the recomputation runs in the caller's transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| free | integration | AC-1, C-41 | no period → FREE, 2 and 30 |
| running | integration | AC-2 | ESSENTIAL fields |
| chain | integration | AC-3 | last end |
| lower next | integration | AC-4 | PRO then ESSENTIAL |
| after the end | integration | AC-5 | each Examples row → result |
| five columns | integration | AC-6 | other columns unchanged |
| other business | security | AB-1, CWE-639 | B is FREE, A untouched |

Command: `npx vitest run tests/integration/billing/rights.test.ts`

## Out of scope
- Pausing or resuming seats and products: BIL-019 and BIL-020.
