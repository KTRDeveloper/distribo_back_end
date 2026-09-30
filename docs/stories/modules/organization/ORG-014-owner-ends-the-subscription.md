---
id: ORG-014
title: Owner ends the subscription
module: organization
kind: feature
rev: 1
amends: []
size: XS
risk: low
depends_on: [ORG-013]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.routes.ts]
design_refs: [finances/subscription]
constraints: ['Subscription.status:enum']
asvs: [v5.0.0-8.2.1]
---

# ORG-014 — Owner ends the subscription

## Story
As an owner, I want to end my subscription so that the business falls back to the free plan.

## Context
- Exists: `POST` and `GET .../subscription` (ORG-013).
- Adds: `DELETE /api/v1/organizations/{organizationId}/subscription` (204): the ACTIVE row becomes EXPIRED with `ends_at` = now. History stays. No ACTIVE row answers 404.
- `Subscription.status:enum`: one of ACTIVE, EXPIRED

## Acceptance criteria
```gherkin
Scenario: AC-1 End
  When the owner deletes the ACTIVE subscription
  Then the response is 204, the row is EXPIRED and `ends_at` is now
Scenario: AC-2 Nothing to end
  When no ACTIVE subscription exists
  Then the response is 404 `NOT_FOUND`
Scenario: AC-3 History
  Then the ended row stays and a new subscription can be started
```

## Abuse cases
```gherkin
Scenario: AB-1 Non-owner ends it (vertical)
  When a MANAGER deletes the subscription
  Then the response is 403 and the row stays ACTIVE
```

## Implementation
- Create: `tests/integration/organization/subscription-end.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `endSubscription(actor: Actor): Promise<void>`
- Errors: `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`

## Security
- v5.0.0-8.2.1: owner and network only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| end | integration | AC-1, Subscription.status:enum | 204, EXPIRED, ends_at now |
| nothing to end | integration | AC-2 | 404 |
| history | integration | AC-3 | row kept; new start works |
| non-owner | security | AB-1, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/organization/subscription-end.test.ts`

## Out of scope
- Automatic expiry at `ends_at` (a lapsed row is replaced when a new one starts).
