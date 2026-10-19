---
id: BIL-016
title: The owner reads the subscription screen
module: billing
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [BIL-018, BIL-013, BIL-033, ORG-035, CAT-020]
read_first: [src/modules/billing/billing.owner.routes.ts, src/modules/billing/rights.service.ts]
design_refs: [finances/subscription, finances/subscription/plans-on-paie-pour-son-equipe]
constraints: [C-42]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# BIL-016 — The owner reads the subscription screen

## Story
As an owner, I want to see my plan, its end, my periods and what a lower plan would pause so that I decide when to pay again.

## Context
- Exists: `billing.owner.routes.ts` (BIL-018), `computeRights` (BIL-013), `readQueueFor` (BIL-033), `listTeamSeats` (ORG-035), `listProductsOnSale` (CAT-020), `loadActor`.
- `GET /api/v1/organizations/{organizationId}/billing` on that router. Chain: sign-in, `loadActor`; the service refuses a role other than OWNER with 403 `FORBIDDEN`. No query field.
- Rights are those of `computeRights` at `now`, so the screen never writes. `usage.collaborators` counts non-owner seats ACTIVE or INVITED, `usage.products` the products on sale.
- `readAfterEnd(organizationId, now)`, exported for the reminders (BIL-026), gives `after_end`: null for a FREE plan; else the rights at `plan_ends_at` plus `GRACE_DAYS` (BIL-010): `{ plan, collaborators_to_pause, products_to_pause }`, each `max(0, usage − limit)`, a missing limit counting as no excess.
- Answer 200 `{ plan, plan_ends_at, grace_ends_at, max_collaborators, max_products, periods, usage, after_end }`; `periods` lists the ACTIVE and SCHEDULED ones as `{ plan, status, starts_at, ends_at }`, earliest first.
- `C-42`: the collaborator limit counts the non-owner collaborations that are ACTIVE or INVITED; the owner never counts.
- `C-42`: At each invitation, the ACTIVE or INVITED collaborators of an organization, owner excluded, number at most `Organization.max_collaborators`; the status PAUSED is written by the server only and never for the OWNER.

## Acceptance criteria
```gherkin
Scenario: AC-1 A running plan
  Given ESSENTIAL running until D, 3 ACTIVE and 1 INVITED non-owner seats, 40 products on sale
  When the owner reads the screen
  Then the answer is 200 with plan ESSENTIAL, `plan_ends_at` D, no grace, limits 5 and no limit, one ACTIVE period, usage 4 and 40, and `after_end` FREE with 2 collaborators and 10 products to pause
Scenario: AC-2 A lower plan next
  Given PRO running until D, ESSENTIAL scheduled from D, 8 seats and 12 products
  When the owner reads the screen
  Then `after_end` is ESSENTIAL with 3 collaborators and 0 products to pause, and `periods` lists both
Scenario: AC-3 A free business
  When the owner of a business with no period reads the screen
  Then the plan is FREE, `periods` is empty and `after_end` is null
Scenario Outline: AC-4 Who may
  When <caller> reads it
  Then the answer is <answer>
  Examples:
    | caller                          | answer                |
    | a manager, a seller or a driver | 403 `FORBIDDEN`       |
    | a person who is not signed in   | 401 `UNAUTHORIZED`    |
    | a person outside the business   | 404 `NOT_FOUND`       |
Scenario: AC-5 Reading changes nothing
  When the owner reads the screen twice
  Then no row of the business changes and no event is written
```

## Abuse cases
```gherkin
Scenario: AB-1 A team member reads the subscription (elevation)
  When a manager reads the screen of their own business
  Then the answer is 403 and holds no plan, date or count
Scenario: AB-2 Another business's screen by its id (information disclosure)
  When an owner of A reads B's id
  Then the answer is 404, equal to an unknown id's
```

## Implementation
- Create: `src/modules/billing/owner-view.service.ts`, `tests/integration/billing/owner-view.test.ts`
- Modify: `src/modules/billing/billing.owner.routes.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `readOwnerBilling(actor: OrganizationActor, now: Date): Promise<OwnerBillingView>`
  - `readAfterEnd(organizationId: string, now: Date): Promise<AfterEnd | null>`
- Types:
  - `AfterEnd = { plan: PlanCode; collaborators_to_pause: number; products_to_pause: number }`
  - `OwnerBillingView = PlanFields in snake_case + { periods: { plan; status; starts_at; ends_at }[]; usage: { collaborators: number; products: number }; after_end: AfterEnd | null }`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: only the owner reads; the service checks the role.
- v5.0.0-8.2.2: every read uses the organization id from `loadActor`.
- v5.0.0-15.3.1: the answer lists its fields: no person, payment or receipt data.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| running | integration | AC-1, C-42 | fields, usage, after_end |
| lower next | integration | AC-2 | ESSENTIAL preview |
| free | integration | AC-3 | FREE, null |
| who may | integration | AC-4 | each Examples row → answer |
| read only | integration | AC-5 | rows unchanged |
| team member | security | AB-1, CWE-285 | 403, no data |
| other business | security | AB-2, CWE-639 | 404 equal to unknown |

Command: `npx vitest run tests/integration/billing/owner-view.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the billing path | add GET /api/v1/organizations/{organizationId}/billing, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the billing path | add GET /api/v1/organizations/{organizationId}/billing, remove nothing |

## Out of scope
- The list of receipts: BIL-017. Choosing what to keep: BIL-018.
