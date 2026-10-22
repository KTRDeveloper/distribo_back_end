---
id: ORG-043
title: The public-contact flag column and its database rule are dropped
module: organization
kind: migration
rev: 3
amends: [ORG-003, ORG-011]
size: M
risk: high
depends_on: [ORG-031, ORG-039]
read_first: [src/modules/organization/organization.repository.ts, src/modules/privacy/privacy.repository.ts]
design_refs: [identite-et-organisation/collaboration, contraintes-a-poser-au-niveau-base-de]
constraints: [C-05, C-35]
asvs: [v5.0.0-15.3.1]
---

# ORG-043 — The public-contact flag column and its database rule are dropped

## Story
Technical story: drop unused `collaborations.is_public_contact`, its rule and supporting trigger.

## Context
- ORG-003: `collaborations_check_row()` requires ACTIVE collaborations to reference registered people, and flagged members ACTIVE with a number. `people_clear_public_contact` runs on `people`. ORG-031/029/039 retired flag usage.
- Migration `<timestamp>_org_043_drop_collaboration_public_contact`: (1) preflight `DO` rejects `deleted_at IS NULL AND is_public_contact`, ids only (max 20); (2) keep only the registered-person rule in `collaborations_check_row()`; (3) drop trigger/function `people_clear_public_contact`; (4) drop flag column. Deleted flags do not block and are discarded. Never create contacts.
- Remove five flag-false writes in `organization.repository.ts`, one in `privacy.repository.ts`, the Prisma field and its bullet above `Collaboration`.
- Preflight test: scratch table `collaborations(id uuid, is_public_contact boolean, deleted_at timestamptz)` first in `search_path`, transaction/rollback as in ORG-032.
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Objects removed
  Then no flag column or `people_clear_public_contact` trigger/function remains
Scenario: AC-2 Live flags block
  Given two live flagged scratch rows and one soft-deleted flagged row
  When the preflight runs
  Then the error contains only the two live ids, no deleted id or personal data
Scenario: AC-3 Unflagged rows pass
  Given only live unflagged scratch rows
  When the preflight runs
  Then it succeeds
Scenario: AC-4 Registered-person rule stays
  When an ACTIVE collaboration is inserted for an unregistered person
  Then PostgreSQL rejects it with 23514
Scenario: AC-5 Number released
  When a member's `phone_number` becomes null
  Then the update succeeds and the collaboration is unchanged
Scenario: AC-6 Soft-deleted flag passes
  Given only a flagged scratch row with `deleted_at` set
  When the preflight runs
  Then it passes; dropping the column discards the flag without creating contacts
```

## Abuse cases
```gherkin
Scenario: AB-1 Silent loss (repudiation)
  Given a live flagged collaboration
  When the migration runs
  Then it stops before changes, reporting live flagged ids only, no personal data
```

## Implementation
- Create: `prisma/migrations/<timestamp>_org_043_drop_collaboration_public_contact/migration.sql`, `tests/integration/organization/collaboration-flag-dropped.test.ts`
- Modify: `prisma/schema.prisma`, `src/modules/organization/organization.repository.ts`, `src/modules/privacy/privacy.repository.ts`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: none added

## Security
- v5.0.0-15.3.1: preflight diagnostics contain ids only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| objects gone | integration | AC-1, C-35 | no flag column or people trigger/function |
| preflight stops | integration | AC-2 | two live flags + deleted flag → live ids only, no deleted id or personal data |
| preflight passes | integration | AC-3 | live unflagged rows → success |
| registered person | integration | AC-4, C-05 | ACTIVE guest → 23514 |
| number released | integration | AC-5 | phone_number null → success, collaboration unchanged |
| deleted flag ignored | integration | AC-6 | deleted_at set, flag true → pass; flag discarded, no contact |
| no silent loss | security | AB-1, CWE-778 | live flag → stop before changes, ids only |

Command: `npx vitest run tests/integration/organization tests/integration/privacy`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/collaboration-table.test.ts | flag rules/people trigger/column list | remove flag cases/column; keep registered-person cases |
| tests/integration/organization/close.test.ts | helper + three assertions use flag | remove flag only |
| tests/integration/organization/revoke.test.ts | seeds/asserts flag | remove flag only |
| tests/integration/organization/transfer.test.ts | seeds flag; 'leaves is_public_contact unchanged' case | remove flag from seeds and that case |
| tests/integration/organization/invite.test.ts | two flag-false assertions | remove flag only |
| tests/integration/organization/create.test.ts | OWNER flag-false assertion | remove flag only |
| tests/integration/organization/team-list.test.ts | seeds flag | seed without flag |
| tests/integration/privacy/anonymize.test.ts | seeds flag/asserts false | remove flag only |
| tests/integration/sync/pull-identity-removed-fields.test.ts | three flag seeds | remove only these fields; keep non-disclosure/scope assertions |
| tests/integration/organization/lookup-contacts.test.ts | flag seeds/assertions | remove flag usage only; keep access/scope/privacy checks |
| tests/integration/organization/public-contact-removed.test.ts | flag usage; unsafe array return | remove flag usage, type return explicitly; keep access/scope/privacy checks and lint rules |

## Out of scope
- Converting flagged numbers to contacts: owner's decision, unresolved.
