---
id: ORG-030
title: An invitation respects the collaborator limit of the plan
module: organization
kind: change
rev: 1
amends: [ORG-007]
size: S
risk: high
depends_on: [ORG-007, ORG-020, ORG-022]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/collaboration, identite-et-organisation/organization]
constraints: [C-42]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3]
---

# ORG-030 — An invitation respects the collaborator limit of the plan

## Story
As an owner, I want the invitation to stop at the number of collaborators my plan pays for so that the team stays within what I subscribed to.

## Context
- Exists: `inviteCollaborator(actor, input)` (ORG-007) inserts an INVITED row or reuses a REVOKED one; the plan columns (ORG-020); the PAUSED status (ORG-022).
- New rule: invitations that are ACTIVE or INVITED, owner excluded, deleted rows excluded, may not exceed `max_collaborators` (null = no limit). The invitation that would exceed it answers 409 `COLLABORATOR_LIMIT_REACHED`, stores nothing and notifies nobody. REVOKED and PAUSED rows do not count.
- Inviting a REVOKED person again is a new invitation and counts. A PAUSED person is still in the team: inviting them answers 409 `ALREADY_MEMBER`, as for an ACTIVE or INVITED one.
- Count inside the gesture's transaction after locking the organization row (`SELECT … FOR UPDATE` through `$queryRaw`, parameterized), so two simultaneous invitations cannot both take the last place.
- Order of checks: rate limit, organization ACTIVE, `ALREADY_MEMBER`, then the limit.
- Add the 409 to the invitation route in `organization.openapi.ts`.
- `C-42`: At each invitation, the ACTIVE or INVITED collaborators of an organization, owner excluded, number at most `Organization.max_collaborators`; the status PAUSED is written by the server only and never for the OWNER.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The limit counts ACTIVE and INVITED collaborators
  Given a business with <active> ACTIVE and <invited> INVITED collaborators besides the owner and `max_collaborators` <max>
  When the owner invites a new person
  Then the answer is <status>
  Examples:
    | active | invited | max  | status                            |
    | 1      | 0       | 2    | 201                               |
    | 1      | 1       | 2    | 409 COLLABORATOR_LIMIT_REACHED    |
    | 2      | 0       | 2    | 409 COLLABORATOR_LIMIT_REACHED    |
    | 6      | 3       | null | 201                               |
Scenario: AC-2 Revoked and paused collaborators leave room
  Given the business has 1 ACTIVE, 1 REVOKED and 1 PAUSED collaborator and `max_collaborators` 2
  When the owner invites a new person
  Then the answer is 201
Scenario: AC-3 Inviting a revoked person again counts
  Given the business is at its limit
  When the owner invites a REVOKED person
  Then the answer is 409 COLLABORATOR_LIMIT_REACHED and the row stays REVOKED
Scenario: AC-4 A paused person is already a member
  When the owner invites a PAUSED person, at the limit or below it
  Then the answer is 409 ALREADY_MEMBER
Scenario: AC-5 A refusal leaves no trace
  When the limit refuses an invitation
  Then no person, collaboration or notification is created
```

## Abuse cases
```gherkin
Scenario: AB-1 Two simultaneous invitations take the last place (race, tampering)
  Given one place is left
  When two invitations arrive together
  Then exactly one answers 201, the other 409 COLLABORATOR_LIMIT_REACHED, and the team never exceeds the limit
```

## Implementation
- Create: `tests/integration/organization/invite-limit.test.ts`
- Modify: `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `lockOrganizationSeats(tx: Prisma.TransactionClient, organizationId: string): Promise<{ maxCollaborators: number | null }>`
  - `countTeamSeats(tx: Prisma.TransactionClient, organizationId: string): Promise<number>`
- Errors: `COLLABORATOR_LIMIT_REACHED` 409, `ALREADY_MEMBER` 409
- Dependencies: none added

## Security
- v5.0.0-8.2.1: the limit comes from the stored plan fields, never from the request.
- v5.0.0-2.3.3: the row lock and the count share one transaction, so a race cannot exceed the limit.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| limit table | integration | AC-1, C-42 | each Examples row → status |
| room left | integration | AC-2 | REVOKED and PAUSED not counted → 201 |
| revoked again | integration | AC-3 | at limit → 409, row still REVOKED |
| paused person | integration | AC-4 | PAUSED invited → 409 ALREADY_MEMBER |
| no trace | integration | AC-5 | refusal → no new person, collaboration or notification |
| race | security | AB-1, CWE-362 | two parallel invitations, one place → one 201, one 409 |

Command: `npx vitest run tests/integration/organization/invite-limit.test.ts tests/integration/organization/invite.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/invite.test.ts | `seedOrg` leaves `max_collaborators` at its default 2 while ORG_A already holds three ACTIVE members | `seedOrg` sets `maxCollaborators: null` for ORG_A so the existing invitation cases run without a limit |

## Out of scope
- Pausing collaborators after a plan drop and resuming them: billing (BIL).
- Showing the limit to the phone: the plan fields reach the team by synchronization (SYNC).
