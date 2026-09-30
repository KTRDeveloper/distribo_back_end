---
id: ORG-016
title: Owner closes the business
module: organization
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORG-014, ORG-010, ACC-005, ACC-007]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/organization]
constraints: ['Organization.status:enum', CM-10, CM-03]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# ORG-016 — Owner closes the business

## Story
As an owner, I want to close my business so that it takes no new orders or customers while its history stays.

## Context
- Exists: statuses (ORG-001), team revocation (ORG-010), subscription end (ORG-014); `requireAbility('close', 'Organization')`.
- Adds: `POST /api/v1/organizations/{organizationId}/close` with `{ id }`; response 200 `{ status: 'CLOSED' }`.
- One transaction: status becomes CLOSED (only from ACTIVE; a SUSPENDED or already CLOSED organization answers 409 `ORGANIZATION_NOT_ACTIVE`); every non-owner ACTIVE or INVITED collaboration becomes REVOKED with `is_public_contact` false and, for ACTIVE ones, `scope_version` +1 and a notification `organization.closed`; the ACTIVE subscription becomes EXPIRED with `ends_at` = now.
- The refusal of pending orders is added by ORD-018; relations, balances and history are untouched.
- `Organization.status:enum`: one of ACTIVE, SUSPENDED, CLOSED
- `CM-10`: CLOSED (by the owner, reopenable): no new order or customer, not findable by number, pending orders refused with reason 'Commerce fermé', team revoked, subscription stopped; relations, balances and history stay visible and payments stay possible.
- `CM-03`: `Person.scope_version` is incremented by the server on every rights change.

## Acceptance criteria
```gherkin
Scenario: AC-1 Close
  When the owner closes an ACTIVE organization
  Then the status is CLOSED
Scenario: AC-2 Team and subscription
  Then every non-owner collaboration is REVOKED with the flag false, ACTIVE ones were notified and had scope_version +1, and the subscription is EXPIRED
Scenario: AC-3 Owner keeps access
  Then the owner's collaboration is still ACTIVE and can read the organization
Scenario Outline: AC-4 Refusals
  When the organization is <status>
  Then the response is 409 `ORGANIZATION_NOT_ACTIVE`
  Examples:
    | status    |
    | SUSPENDED |
    | CLOSED    |
Scenario: AC-5 Atomic
  When any step fails
  Then the organization is still ACTIVE and the team unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 Manager closes the business (vertical)
  When a MANAGER posts to close
  Then the response is 403 and the status is unchanged
Scenario: AB-2 Closing another business (horizontal)
  When a member of A posts to close B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/organization/close.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `closeOrganization(actor: Actor, input: { id: string }): Promise<{ status: 'CLOSED' }>`
- Errors: `ORGANIZATION_NOT_ACTIVE` 409, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.1: owner and network only.
- v5.0.0-2.3.3: status, team and subscription change together.
- v5.0.0-16.3.1: log `warn` event `organization_closed` with organization and owner ids.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| close | integration | AC-1, Organization.status:enum, CM-10 | CLOSED |
| team and subscription | integration | AC-2, CM-03 | revoked, notified, expired |
| owner access | integration | AC-3 | still ACTIVE, readable |
| refusals | integration | AC-4 | 409 |
| atomic | integration | AC-5, CWE-362 | forced failure → unchanged |
| manager | security | AB-1, WSTG-ATHZ-03 | 403 |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/organization/close.test.ts`

## Out of scope
- Refusing pending orders (ORD-018). Reopening (ORG-017).
