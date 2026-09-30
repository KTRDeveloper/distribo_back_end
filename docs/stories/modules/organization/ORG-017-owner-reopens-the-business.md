---
id: ORG-017
title: Owner reopens the business
module: organization
kind: feature
rev: 1
amends: []
size: XS
risk: medium
depends_on: [ORG-016]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.routes.ts]
design_refs: [identite-et-organisation/organization]
constraints: ['Organization.status:enum', CM-10]
asvs: [v5.0.0-8.2.1]
---

# ORG-017 — Owner reopens the business

## Story
As an owner, I want to reopen a closed business so that it can trade again.

## Context
- Exists: `POST .../close` (ORG-016); `requireAbility('reopen', 'Organization')`.
- Adds: `POST /api/v1/organizations/{organizationId}/reopen` with `{ id }`; response 200 `{ status: 'ACTIVE' }`. Only CLOSED can reopen; the team and the subscription are not restored.
- `Organization.status:enum`: one of ACTIVE, SUSPENDED, CLOSED
- `CM-10`: CLOSED (by the owner, reopenable): no new order or customer, not findable by number, pending orders refused with reason 'Commerce fermé', team revoked, subscription stopped; relations, balances and history stay visible and payments stay possible.

## Acceptance criteria
```gherkin
Scenario: AC-1 Reopen
  When the owner reopens a CLOSED organization
  Then the status is ACTIVE and the revoked collaborators stay REVOKED
Scenario Outline: AC-2 Refusals
  When the organization is <status>
  Then the response is 409 `ORGANIZATION_NOT_CLOSED`
  Examples:
    | status    |
    | ACTIVE    |
    | SUSPENDED |
```

## Abuse cases
```gherkin
Scenario: AB-1 Owner lifts a moderation suspension (elevation)
  When the owner posts to reopen a SUSPENDED organization
  Then the response is 409 and the suspension stays
Scenario: AB-2 Manager reopens (vertical)
  When a MANAGER posts to reopen
  Then the response is 403
```

## Implementation
- Create: `tests/integration/organization/reopen.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `reopenOrganization(actor: Actor): Promise<{ status: 'ACTIVE' }>`
- Errors: `ORGANIZATION_NOT_CLOSED` 409, `FORBIDDEN` 403
- Dependencies: `express`

## Security
- v5.0.0-8.2.1: owner and network only; a moderation suspension is never lifted here.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| reopen | integration | AC-1, Organization.status:enum, CM-10 | ACTIVE, team stays revoked |
| refusals | integration | AC-2 | 409 |
| suspension stays | security | AB-1, CWE-284 | 409 |
| manager | security | AB-2, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/organization/reopen.test.ts`

## Out of scope
- Reactivation after suspension (ADM module).
