---
id: BIL-005
title: The owner can no longer write a subscription
module: billing
kind: removal
rev: 1
amends: [ORG-013, ORG-014, ORG-016]
size: S
risk: medium
depends_on: [ORG-034, ORG-020]
read_first: [src/modules/organization/organization.routes.ts, src/modules/organization/organization.service.ts]
design_refs: [finances/subscription]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# BIL-005 — The owner can no longer write a subscription

## Story
As an owner, I want my plan to come only from a confirmed payment so that nobody can set a plan without paying.

## Context
- Exists: `POST`, `GET` and `DELETE /api/v1/organizations/{organizationId}/subscription` (ORG-013, ORG-014); `startSubscription`, `getSubscription`, `endSubscription`; `expireLapsedSubscriptions`, `insertSubscription`, `endActiveSubscription`, `findActiveSubscription`; `startSubscriptionSchema` with the subscription view types; three paths in `organization.openapi.ts`; one `endActiveSubscription` call in `closeOrganization` (ORG-016).
- Remove all of them, with the `Subscription` type import. The three paths then answer the router's 404 `NOT_FOUND`. A plan is paid on a website and only the server writes it (BIL-009 onward).
- `closeOrganization` keeps running the close hooks (ORG-034) and no longer touches `subscriptions`; billing ends the plans in a close hook (BIL-031).
- Stay for now: the table and the Prisma model `Subscription` (BIL-002 rebuilds them) and the rule row `manage Subscription` (BIL-006).

## Acceptance criteria
```gherkin
Scenario: AC-1 The three routes are gone
  When the OWNER sends POST `{ "plan": "PRO" }` and DELETE, and a member sends GET, each to `…/subscription`
  Then each answer is 404 `NOT_FOUND` and no subscription row changes
Scenario: AC-2 Closing a business still works
  When the OWNER closes the business
  Then the answer is 200, the business is CLOSED and the team is revoked
Scenario: AC-3 The documentation lists no subscription path
  When a client reads `/api/v1/docs/openapi.json`
  Then no path ends with `/subscription`
```

## Abuse cases
```gherkin
Scenario: AB-1 A plan is set without paying (elevation, T4)
  When an OWNER and a MANAGER each send POST `{ "plan": "ENTERPRISE" }` to `…/subscription`
  Then both get 404 `NOT_FOUND`, the count of `subscriptions` is unchanged and `organizations.plan` is still FREE
```

## Implementation
- Create: `tests/integration/organization/subscription-routes-removed.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/middleware/require-ability.ts`
- Errors: `NOT_FOUND` 404
- Dependencies: none added

## Security
- v5.0.0-8.2.1: no route lets the client write a plan; the only writer is the server after a payment.
- v5.0.0-15.3.3: no body field reaches `subscriptions` or the plan columns of an organization.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| routes gone | integration | AC-1 | POST, DELETE and GET → 404, rows unchanged |
| close | integration | AC-2 | owner closes → 200, CLOSED, team revoked |
| docs | integration | AC-3 | openapi.json has no `/subscription` path |
| no free plan | security | AB-1, CWE-285 | OWNER and MANAGER post a plan → 404, count unchanged, plan FREE |

Command: `npx vitest run tests/integration/organization tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/subscription-start.test.ts | every case calls the removed POST route | file deleted; subscription-routes-removed.test.ts covers the refused route |
| tests/integration/organization/subscription-end.test.ts | every case calls the removed DELETE and GET routes | file deleted; subscription-routes-removed.test.ts covers the refused routes |
| tests/integration/organization/close.test.ts | AC-2 expects the ACTIVE subscription to become EXPIRED and AC-5 expects a failing trigger on `subscriptions` to undo the close | both cases and the seeds of `subscriptions` are dropped; a failing close hook is covered by lifecycle-hooks.test.ts (ORG-034) |
| tests/integration/api-docs/catalog.test.ts | lists the path `/api/v1/organizations/{organizationId}/subscription` | the path is removed from the list and checked absent |

## Out of scope
- Dropping or rebuilding the table: BIL-002.
- The `manage Subscription` rule row: BIL-006.
