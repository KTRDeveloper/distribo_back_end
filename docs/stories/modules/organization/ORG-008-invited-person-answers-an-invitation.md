---
id: ORG-008
title: Invited person answers an invitation
module: organization
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORG-007]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/collaboration]
constraints: [C-05, CM-03]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# ORG-008 — Invited person answers an invitation

## Story
As a customer, I want to see my team invitations and accept or decline each one so that I choose which business I join.

## Context
- Exists: INVITED collaborations (ORG-007); `bumpScopeVersion`; `notify`.
- Adds: `GET /api/v1/collaborations?status=INVITED` (own invitations: `id, organization_id, organization_name, role, invited_at`, paginated); `POST /api/v1/collaborations/{id}/accept` and `POST /api/v1/collaborations/{id}/decline` (204).
- Accept: the caller must be the invited person, registered, and the collaboration INVITED; it becomes ACTIVE with `accepted_at` = now, the caller's `scope_version` is bumped and the owner gets a notification `collaboration.accepted`.
- Decline: the collaboration becomes REVOKED (it can be invited again later).
- Any other state or another person's id answers 404 `NOT_FOUND`.
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction; `is_public_contact` needs ACTIVE status and a person with an active number.
- `CM-03`: `Person.scope_version` is incremented by the server on every rights change.

## Acceptance criteria
```gherkin
Scenario: AC-1 List
  Given two invitations and one ACTIVE collaboration
  When the invitee GETs the list
  Then two items are returned with organization names
Scenario: AC-2 Accept
  When the invitee accepts
  Then the response is 204, the row is ACTIVE with accepted_at set, scope_version is +1 and the owner is notified
Scenario: AC-3 Decline
  When the invitee declines
  Then the response is 204 and the row is REVOKED
Scenario Outline: AC-4 Not possible
  When the call is on <case>
  Then the response is 404 `NOT_FOUND` and nothing changes
  Examples:
    | case                                      |
    | an already ACTIVE collaboration           |
    | a REVOKED collaboration                   |
    | someone else's invitation                 |
    | an unknown id                             |
```

## Abuse cases
```gherkin
Scenario: AB-1 Accepting someone else's invitation (horizontal)
  When person A accepts an invitation addressed to person B
  Then the response is 404 and B's invitation is unchanged
Scenario: AB-2 Choosing the role on accept (mass assignment)
  When the accept call carries a body with role OWNER
  Then the role is unchanged
```

## Implementation
- Create: `tests/integration/organization/invitations.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `acceptInvitation(personId: string, collaborationId: string): Promise<void>`
  - `declineInvitation(personId: string, collaborationId: string): Promise<void>`
- Errors: `NOT_FOUND` 404, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: updates filter on the collaboration id and the person id from the token.
- v5.0.0-15.3.1: explicit fields in the list.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1 | two items |
| accept | integration | AC-2, C-05, CM-03 | ACTIVE, scope +1, owner notified |
| decline | integration | AC-3 | REVOKED |
| not possible | integration | AC-4 | each Examples row → 404 |
| other person | security | AB-1, WSTG-ATHZ-04 | 404, unchanged |
| body ignored | security | AB-2, CWE-915 | role unchanged |

Command: `npx vitest run tests/integration/organization/invitations.test.ts`

## Out of scope
- Registration showing invitations next to relationships (REL module).
