---
id: ORG-015
title: Owner transfers the ownership
module: organization
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORG-008, ACC-005, ACC-007]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/collaboration]
constraints: [C-05, CM-09, CM-03]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# ORG-015 — Owner transfers the ownership

## Story
As an owner, I want to hand my business to another collaborator so that it can be sold or inherited without recreating it.

## Context
- Exists: the exactly-one-owner rule with a deferred check (ORG-003); `requireAbility('transfer_ownership', 'Organization')`; `bumpScopeVersion`; `notify`.
- Adds: `POST /api/v1/organizations/{organizationId}/transfer-ownership` with `{ id, collaboration_id }`; response 200 `{ new_owner_collaboration_id }`.
- One transaction: the target ACTIVE collaboration becomes OWNER (its `is_public_contact` unchanged), the caller's becomes MANAGER, both people's `scope_version` +1; the new owner gets a notification `ownership.received`. The former owner's held money is handed over by FIN-017.
- Target must be ACTIVE, belong to the organization and not be the caller; an INVITED, REVOKED or foreign target answers 404.
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction; `is_public_contact` needs ACTIVE status and a person with an active number.
- `CM-09`: The OWNER can be neither demoted nor revoked; an ownership transfer makes the chosen ACTIVE collaborator OWNER and the former owner MANAGER in one transaction; a revocation takes effect immediately.
- `CM-03`: `Person.scope_version` is incremented by the server on every rights change.

## Acceptance criteria
```gherkin
Scenario: AC-1 Transfer
  When the owner names an ACTIVE manager
  Then the manager is OWNER, the caller is MANAGER, and there is exactly one ACTIVE OWNER
Scenario: AC-2 Rights counters and notice
  Then both people's `scope_version` is +1 and the new owner has one unread `ownership.received`
Scenario Outline: AC-3 Refusals
  When the target is <case>
  Then the response is <status> and nothing changes
  Examples:
    | case                                | status              |
    | the caller                          | 400 VALIDATION_ERROR|
    | INVITED                             | 404 NOT_FOUND       |
    | REVOKED                             | 404 NOT_FOUND       |
    | in another business                 | 404 NOT_FOUND       |
Scenario: AC-4 Atomic
  When the second update fails
  Then the caller is still OWNER and nobody else is
Scenario: AC-5 Repeat
  When the same body is posted twice
  Then the second answer equals the first
```

## Abuse cases
```gherkin
Scenario: AB-1 Manager takes the business (vertical)
  When a MANAGER posts a transfer to themselves
  Then the response is 403 and nothing changes
Scenario: AB-2 Transfer without the network (elevation)
  Then the rule for transfer needs `online`, so a phone judging offline is refused
```

## Implementation
- Create: `tests/integration/organization/transfer.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `transferOwnership(actor: Actor, input: { id: string; collaboration_id: string }): Promise<{ new_owner_collaboration_id: string }>`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.1: owner and network only.
- v5.0.0-2.3.3: both role changes and both scope bumps are one transaction.
- v5.0.0-16.3.1: log `warn` event `ownership_transferred` with organization and both person ids.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| transfer | integration | AC-1, C-05, CM-09 | roles swapped, one owner |
| counters and notice | integration | AC-2, CM-03 | +1 each, notification |
| refusals | integration | AC-3 | each Examples row → status |
| atomic | integration | AC-4, CWE-362 | forced failure → unchanged |
| repeat | integration | AC-5 | equal answers |
| manager takes over | security | AB-1, WSTG-ATHZ-03 | 403 |
| offline refused | security | AB-2, CWE-863 | ability with online false → refused |

Command: `npx vitest run tests/integration/organization/transfer.test.ts`

## Out of scope
- Automatic handover of the former owner's held money (FIN-017).
