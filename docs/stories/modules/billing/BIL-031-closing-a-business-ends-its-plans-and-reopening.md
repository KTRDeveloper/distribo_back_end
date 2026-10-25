---
id: BIL-031
title: Closing a business ends its plans and reopening restarts from free
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-005, BIL-013, BIL-020, BIL-027, ORG-034, ORG-045]
read_first: [src/modules/billing/rights.service.ts, src/app.ts]
design_refs: [finances/subscription]
constraints: [C-52]
asvs: [v5.0.0-2.3.3, v5.0.0-8.2.2]
---

# BIL-031 — Closing a business ends its plans and reopening restarts from free

## Story
Technical story: let billing stop the plans of a business when it is closed and restart it from the free plan when it is reopened, inside the closing and reopening transactions.

## Context
- Exists: `registerLifecycleHook` (ORG-034; the hooks run in the closing or reopening transaction and a failing hook aborts it); `lockSubscriptions`, `listQueue`, `insertEvent` (BIL-011); `endPeriod` (BIL-027); `recomputeRights` (BIL-013); `enforceLimits` (BIL-020); `readPlanFields` (ORG-045); `writePlanFields` (ORG-035); `PLANS` (FND-014). BIL-005 stopped `closeOrganization` from touching `subscriptions`.
- `registerBillingLifecycleHooks()` in the new `lifecycle.service.ts` registers one hook, once, however often it is called; `src/app.ts` calls it at start.
- Close: lock; each ACTIVE or SCHEDULED period ends with reason CLOSED (ACTIVE: `ends_at` is the earlier of its end and `now`; SCHEDULED: `ends_at = starts_at`), one FORFAIT_ENDED event each (actor SYSTEM). Then the five plan fields are written as FREE (no dates, the limits of `PLANS.FREE`), even during a grace, and one PLAN_CHANGED event (old plan to FREE) is written when the plan was not FREE. Nothing is paused: the close revokes the team itself.
- Reopen: lock, `recomputeRights`, `enforceLimits`. A period bought while the business was closed counts; products above the free limit are paused.
- `C-52`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); periods of one organization never overlap (exclusion constraint); `starts_at` is not after `ends_at`; `payment_id` and `months` are set exactly when `origin = PAYMENT`; `end_reason` is set exactly when `status = ENDED`; only the server writes it.

## Acceptance criteria
```gherkin
Scenario: AC-1 Close ends the plans
  Given an ESSENTIAL ACTIVE period with 20 days left and an ESSENTIAL one SCHEDULED after it
  When the owner closes the business
  Then both periods are ENDED CLOSED (the first with `ends_at = now`, the second with `ends_at = starts_at`), two FORFAIT_ENDED events exist, the plan fields are FREE with no dates, and one PLAN_CHANGED event goes from ESSENTIAL to FREE
Scenario: AC-2 Close during the grace
  Given the last period ENDED EXPIRED 3 days ago and plan columns ESSENTIAL with a grace date
  When the owner closes the business
  Then the plan fields are FREE with no grace date
Scenario: AC-3 A free business
  When a business with no period is closed
  Then no period or event is written and the plan stays FREE
Scenario Outline: AC-4 Reopen
  Given a closed business with <state>
  When the owner reopens it
  Then <result>
  Examples:
    | state                                   | result                                              |
    | 45 products on sale and no period       | the plan is FREE and 15 products are paused         |
    | an ESSENTIAL period bought while closed | the plan is ESSENTIAL and no product is paused      |
Scenario: AC-5 A failure aborts the close
  Given ending a period fails during the close
  When the owner closes the business
  Then the business stays open, its periods and plan fields are unchanged and no event is written
Scenario: AC-6 Registered once
  When `registerBillingLifecycleHooks` is called twice and a business is closed
  Then each period gets one FORFAIT_ENDED event
```

## Abuse cases
```gherkin
Scenario: AB-1 Closing one business touches another (broken access control)
  Given businesses A and B, each with an ACTIVE period
  When A is closed
  Then B's periods, events and plan fields are unchanged
```

## Implementation
- Create: `src/modules/billing/lifecycle.service.ts`, `tests/integration/billing/lifecycle.test.ts`
- Modify: `src/app.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `registerBillingLifecycleHooks(): void`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: ending, rights and events share the closing or reopening transaction.
- v5.0.0-8.2.2: the hook acts on the organization id the organization module gives it, never on a client value.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| close | integration | AC-1, C-52 | periods CLOSED, events, FREE |
| grace | integration | AC-2 | FREE without grace |
| free | integration | AC-3 | nothing written |
| reopen | integration | AC-4 | each Examples row → plan, products |
| abort | integration | AC-5 | failure → nothing changes |
| once | integration | AC-6 | one event per period |
| other business | security | AB-1, CWE-639 | B unchanged |

Command: `npx vitest run tests/integration/billing/lifecycle.test.ts`

### Tests to update
| file | change |
|---|---|
| `tests/integration/organization/lifecycle-hooks.test.ts` | Seed a real active organization in the two direct registry-call tests now that the billing hook is registered at startup; preserve all existing assertions. |

## Out of scope
- The close and reopen operations and their routes: ORG. Refunds: BIL-025.
