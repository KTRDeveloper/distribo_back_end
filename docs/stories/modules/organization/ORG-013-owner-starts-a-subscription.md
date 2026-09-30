---
id: ORG-013
title: Owner starts a subscription
module: organization
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORG-012, ORG-005, ACC-005, ACC-007]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.routes.ts]
design_refs: [finances/subscription]
constraints: [C-31]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# ORG-013 — Owner starts a subscription

## Story
As an owner, I want to record a subscription for my business so that its plan and dates are on file.

## Context
- Exists: `subscriptions` (ORG-012); `requireAbility('manage', 'Subscription')`; `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/subscription` with `{ id, plan, ends_at }`; `plan` 1 to 100 characters; `starts_at` is now; `ends_at` is in the future. Response 201 `{ id, plan, status: 'ACTIVE', starts_at, ends_at }`. No payment is taken and no feature is limited (Q-011).
- In the same transaction an ACTIVE row whose `ends_at` has passed is set to EXPIRED first. A live ACTIVE row answers 409 `SUBSCRIPTION_EXISTS`.
- `GET /api/v1/organizations/{organizationId}/subscription` returns the current ACTIVE row or 404.
- `C-31`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); EXPIRED rows stay as history.

## Acceptance criteria
```gherkin
Scenario: AC-1 Start
  When the owner posts a plan and a future end
  Then the response is 201 and one ACTIVE row exists
Scenario: AC-2 Second active subscription
  When one is live and the owner posts another
  Then the response is 409 `SUBSCRIPTION_EXISTS`
Scenario: AC-3 Lapsed subscription is replaced
  Given an ACTIVE row whose ends_at is in the past
  When the owner posts a new one
  Then the old row is EXPIRED and the new one ACTIVE
Scenario Outline: AC-4 Validation
  When the body has <problem>
  Then the response is 400 `VALIDATION_ERROR`
  Examples:
    | problem                    |
    | ends_at in the past        |
    | plan empty                 |
    | plan of 101 characters     |
    | status in the body         |
Scenario: AC-5 Read
  Then GET returns the ACTIVE row to any member, and 404 when none
```

## Abuse cases
```gherkin
Scenario: AB-1 Non-owner starts a subscription (vertical)
  When a MANAGER, SELLER or DRIVER posts
  Then the response is 403 and nothing is stored
Scenario: AB-2 Another business (horizontal)
  When a member of A posts to business B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/organization/subscription-start.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `startSubscription(actor: Actor, input: { id: string; plan: string; ends_at: string }): Promise<SubscriptionView>`
- Errors: `SUBSCRIPTION_EXISTS` 409, `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: owner and network only.
- v5.0.0-15.3.3: status and dates other than `ends_at` are not writable.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| start | integration | AC-1 | 201, one ACTIVE |
| second active | integration | AC-2, C-31 | 409 |
| lapsed replaced | integration | AC-3 | old EXPIRED, new ACTIVE |
| validation | integration | AC-4 | each Examples row → 400 |
| read | integration | AC-5 | member gets it; none → 404 |
| non-owner | security | AB-1, WSTG-ATHZ-03 | 403 |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/organization/subscription-start.test.ts`

## Out of scope
- Payments and the free plan's limits (Q-011).
