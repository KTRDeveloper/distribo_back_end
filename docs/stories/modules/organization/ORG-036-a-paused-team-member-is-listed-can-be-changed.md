---
id: ORG-036
title: A paused team member is listed, can be changed or revoked, and has no access
module: organization
kind: change
rev: 1
amends: [ORG-007, ORG-009, ORG-010, ORG-019]
size: S
risk: medium
depends_on: [ORG-022, ORG-034, PER-011]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/collaboration]
constraints: [CM-03]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.1]
---

# ORG-036 — A paused team member is listed, can be changed or revoked, and has no access

## Story
As an owner, I want my paused team members to stay in the team list and be manageable so that I can change their role or remove them.

## Context
- Exists: `PAUSED` in the database (ORG-022). A PAUSED member keeps their row and their held money but has no access: `loadActor` accepts ACTIVE only.
- Team list: PAUSED rows already come back; the type `CollaboratorItem` and the OpenAPI enum must say `PAUSED`. `person` now carries `avatar_url` (PER-011): add it to the types and to the OpenAPI person objects of the team list, the invite answer and the role-change answer.
- `changeRole`: `updateRole` also matches PAUSED. A PAUSED target gets the new role and no scope bump, no notice (no right changes, as for INVITED); the answer shows `status` `PAUSED` (`CollaborationView.status` and its OpenAPI enum gain it).
- `revokeCollaboration` also matches PAUSED: REVOKED, amount kept, no bump, no notice. Answer 204 as before.
- `anonymizeRows` in `privacy.repository.ts` also revokes PAUSED rows, so a later resume never reactivates a deleted person.
- Not here: a PAUSED payer or remitter in finance (FIN stories); who becomes PAUSED (ORG-035, billing).
- `CM-03`: `scope_version` is incremented by the server on every rights change.

## Acceptance criteria
```gherkin
Scenario: AC-1 The list shows paused members
  Given an ACTIVE, a PAUSED and a REVOKED member
  When the owner lists the team
  Then the PAUSED item has `status` PAUSED and a `person` with `avatar_url`
Scenario: AC-2 The role of a paused member
  When the owner changes the role of a PAUSED member
  Then the answer is 200 with `status` PAUSED and the new role
  And `scope_version` is unchanged and no notification exists
Scenario: AC-3 Revoking a paused member
  When the owner revokes a PAUSED member
  Then the answer is 204, the row is REVOKED and `amount_held` is kept
  And `scope_version` is unchanged and no notification exists
Scenario: AC-4 Anonymization ends a paused seat
  When the person of a PAUSED member is anonymized
  Then the collaboration is REVOKED
Scenario: AC-5 The documentation says so
  When the OpenAPI document is read
  Then the team-list `status` enum and the role-change `status` enum contain PAUSED
  And the `person` of the team list, the invite answer and the role-change answer has `avatar_url`
```

## Abuse cases
```gherkin
Scenario: AB-1 A paused member keeps working (elevation)
  Given a PAUSED seller
  When they list the team, open the business or read their organizations
  Then the first two answer 404 NOT_FOUND and the business is absent from the third
```

## Implementation
- Create: `tests/integration/organization/paused-seats.test.ts`
- Modify: `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.openapi.ts`, `src/modules/privacy/privacy.repository.ts`
- Pattern: `src/middleware/load-actor.ts`
- Types:
  - `CollaborationView.status = 'INVITED' | 'ACTIVE' | 'PAUSED'`
  - `person = { public_name: string | null; phone_number: string | null; registered: boolean; avatar_url: string | null }`
- Dependencies: none added

## Security
- v5.0.0-8.2.1: the member's access depends on the ACTIVE status read from the database on every request.
- v5.0.0-15.3.1: the `person` object is still built by `toPublicPerson`; no other personal field leaves.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1 | PAUSED item and its person keys |
| role | integration | AC-2, CM-03 | 200, PAUSED, no bump, no notice |
| revoke | integration | AC-3, CM-03 | 204, REVOKED, money kept, no bump |
| anonymize | integration | AC-4 | PAUSED seat → REVOKED |
| documentation | integration | AC-5 | enums and avatar_url in the OpenAPI document |
| no access | security | AB-1, CWE-285 | list 404, detail 404, absent from my organizations |

Command: `npx vitest run tests/integration/organization tests/integration/privacy tests/integration/api-docs`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/team-list.test.ts | the person key list gains `avatar_url` | already changed by PER-011; nothing more here |
| tests/integration/organization/change-role.test.ts | roles of ACTIVE, INVITED and REVOKED rows; no case uses PAUSED | unchanged |

## Out of scope
- Pausing and resuming: ORG-035 and billing.
- A paused member in finance operations: the finance stories.
