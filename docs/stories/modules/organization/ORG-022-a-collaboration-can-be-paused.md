---
id: ORG-022
title: A collaboration can be paused
module: organization
kind: migration
rev: 1
amends: [ORG-003]
size: XS
risk: high
depends_on: [ORG-003]
read_first: [prisma/schema.prisma, tests/integration/organization/amount-held.test.ts]
design_refs: [identite-et-organisation/collaboration, contraintes-a-poser-au-niveau-base-de]
constraints: [C-42, C-05]
asvs: [v5.0.0-2.2.3]
---

# ORG-022 — A collaboration can be paused

## Story
Technical story: add the PAUSED status to collaborations and make the database refuse it for the owner.

## Context
- Exists: `CollaborationStatus` INVITED, ACTIVE, REVOKED; the one-owner trigger and `collaborations_check_row()` (ORG-003).
- Adds one migration, run in one transaction: the value PAUSED in the type, and a CHECK that no OWNER row is PAUSED (C-42). PAUSED means: over the limit of the plan, no access, still in the team (billing writes it, ORG-035).
- Existing rows hold no PAUSED value, so the CHECK already holds: no audit is needed.
- The one-owner trigger counts ACTIVE owners only; a paused owner is impossible, so it does not change.
- `prisma/schema.prisma`: add PAUSED to `enum CollaborationStatus`, and to the `//` comment above `model Collaboration` a plain-language line: a paused member keeps their place in the team but has no access; the owner is never paused; the server alone sets the status; migration name `org_022_collaboration_paused`.
- `Collaboration` fields: `status` enum [INVITED / ACTIVE / PAUSED / REVOKED]
- `C-42`: At each invitation, the ACTIVE or INVITED collaborators of an organization, owner excluded, number at most `Organization.max_collaborators`; the status PAUSED is written by the server only and never for the OWNER.
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Paused rows
  When a collaboration is inserted with role <role> and status <status>
  Then the database <result>
  Examples:
    | role    | status | result          |
    | MANAGER | PAUSED | accepts         |
    | SELLER  | PAUSED | accepts         |
    | OWNER   | PAUSED | rejects (23514) |
    | OWNER   | ACTIVE | accepts         |
Scenario: AC-2 An owner cannot be paused later
  Given an ACTIVE owner
  When its status is updated to PAUSED
  Then the update is rejected with 23514
Scenario: AC-3 A paused member is not an owner
  Given a paused manager and an ACTIVE owner
  Then the organization still has exactly one ACTIVE owner
```

## Abuse cases
```gherkin
Scenario: AB-1 The owner is paused so the business has none (denial of service)
  When code sets the OWNER collaboration to PAUSED, straight in the database
  Then PostgreSQL rejects it with 23514
```

## Implementation
- Create: `prisma/migrations/<timestamp>_org_022_collaboration_paused/migration.sql`, `tests/integration/organization/collaboration-paused.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: role and status are checked together in the database, so no code path can pause the owner.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| paused rows | integration | AC-1, C-42 | each Examples row → accepted or 23514 |
| owner stays active | integration | AC-2, C-42 | OWNER updated to PAUSED → 23514 |
| one owner | integration | AC-3, C-05 | paused manager + ACTIVE owner → one ACTIVE owner |
| owner never paused | security | AB-1, CWE-20 | raw update of the owner to PAUSED → 23514 |

Command: `npx vitest run tests/integration/organization/collaboration-paused.test.ts tests/integration/organization/collaboration-table.test.ts`

## Out of scope
- Pausing and restoring members (ORG-035) and the limit rules (ORG-030).
- Showing PAUSED in views and documents (ORG-036).
