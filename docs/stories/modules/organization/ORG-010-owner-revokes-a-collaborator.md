---
id: ORG-010
title: Owner revokes a collaborator
module: organization
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ORG-008]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.routes.ts]
design_refs: [identite-et-organisation/collaboration]
constraints: ['Collaboration.status:enum', CM-09, CM-03]
asvs: [v5.0.0-8.2.1, v5.0.0-7.4.2]
---

# ORG-010 — Owner revokes a collaborator

## Story
As an owner, I want to revoke a collaborator so that they lose access at once.

## Context
- Exists: collaborators (ORG-007, ORG-008); `requireAbility('manage', 'Collaboration')`; `bumpScopeVersion`.
- Adds: `DELETE /api/v1/organizations/{organizationId}/collaborators/{collaborationId}` (204). The row becomes REVOKED, `is_public_contact` false; an ACTIVE target gets `scope_version` +1 and a notification `collaboration.revoked`.
- The OWNER row answers 409 `OWNER_PROTECTED`. `amount_held` is kept. A REVOKED or foreign row answers 404.
- `Collaboration.status:enum`: one of INVITED, ACTIVE, REVOKED
- `CM-09`: The OWNER can be neither demoted nor revoked; an ownership transfer makes the chosen ACTIVE collaborator OWNER and the former owner MANAGER in one transaction; a revocation takes effect immediately.
- `CM-03`: `Person.scope_version` is incremented by the server on every rights change.

## Acceptance criteria
```gherkin
Scenario: AC-1 Revoke
  When the owner revokes an ACTIVE seller
  Then the response is 204, the row is REVOKED, the public-contact flag is false and the seller's scope_version is +1
Scenario: AC-2 Access ends at once
  Then the revoked person's next call to an organization route answers 404
Scenario: AC-3 Money stays visible
  Then `amount_held` is unchanged
Scenario Outline: AC-4 Refusals
  When the owner targets <case>
  Then the response is <status> and nothing changes
  Examples:
    | case                                 | status              |
    | their own OWNER row                  | 409 OWNER_PROTECTED |
    | an already REVOKED row               | 404 NOT_FOUND       |
    | a row of another business            | 404 NOT_FOUND       |
```

## Abuse cases
```gherkin
Scenario: AB-1 Non-owner revokes (vertical)
  When a MANAGER deletes a collaborator
  Then the response is 403 and the row is unchanged
Scenario: AB-2 Revoking the owner by a crafted call (elevation)
  When the OWNER row id is used
  Then the response is 409 and the organization still has an ACTIVE OWNER
```

## Implementation
- Create: `tests/integration/organization/revoke.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `revokeCollaborator(actor: Actor, collaborationId: string): Promise<void>`
- Errors: `OWNER_PROTECTED` 409, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`

## Security
- v5.0.0-8.2.1: owner and network only.
- v5.0.0-7.4.2: access ends on the next request because the actor is loaded from the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| revoke | integration | AC-1, Collaboration.status:enum, CM-03 | REVOKED, flag false, scope +1 |
| immediate | integration | AC-2, CM-09 | 404 on the next call |
| money kept | integration | AC-3 | amount_held unchanged |
| refusals | integration | AC-4 | each Examples row → status |
| manager | security | AB-1, WSTG-ATHZ-03 | 403 |
| owner protected | security | AB-2, CWE-269 | 409, owner still ACTIVE |

Command: `npx vitest run tests/integration/organization/revoke.test.ts`

## Out of scope
- Erasing the revoked phone's data (SYNC full resync).
