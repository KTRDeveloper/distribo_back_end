---
id: ORG-043
title: The public-contact flag column and its database rule are dropped
module: organization
kind: migration
rev: 1
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
Technical story: drop `collaborations.is_public_contact` with the database rule and the trigger that served it, once nothing reads, writes or sends it.

## Context
- Exists: the column, the trigger `collaborations_check_row` (function `collaborations_check_row()` with two rules: an ACTIVE row needs a registered person; a flagged row needs ACTIVE status and a current number) and the trigger `people_clear_public_contact` on `people` (ORG-003). Code stopped using the flag in ORG-031, ORG-029 and ORG-039.
- Migration `<timestamp>_org_043_drop_collaboration_public_contact`, in this order: (1) preflight `DO` block: if any live row has the flag true, raise an error listing those collaboration ids only (at most 20); (2) replace `collaborations_check_row()` keeping only the registered-person rule; (3) drop the trigger and the function `people_clear_public_contact`; (4) drop the column.
- Remove the five `isPublicContact: false` writes of `organization.repository.ts` and the one in `privacy.repository.ts`; remove the field from `prisma/schema.prisma` and the bullet about the public contact from the `//` comment above `Collaboration`.
- Test the preflight as in ORG-032 (scratch table `collaborations(id uuid, is_public_contact boolean)` first in `search_path`).
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Column, trigger and function are gone
  Then `collaborations` has no `is_public_contact` column and no function `people_clear_public_contact` exists
Scenario: AC-2 The preflight stops on a flagged row
  Given the scratch table holds two flagged rows
  When the preflight runs
  Then it raises an error listing the two ids
Scenario: AC-3 The preflight passes when no row is flagged
  Then it succeeds
Scenario: AC-4 The registered-person rule stays
  When an ACTIVE collaboration is inserted for a person who is not registered
  Then PostgreSQL rejects it with 23514
Scenario: AC-5 A person can lose their number
  When a member's `phone_number` is set to null
  Then the update succeeds and the collaboration is unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 A published number vanishes without notice (repudiation)
  Given a collaboration with the flag true
  When the migration is applied
  Then it stops before any change and names the collaboration by id only
```

## Implementation
- Create: `prisma/migrations/<timestamp>_org_043_drop_collaboration_public_contact/migration.sql`, `tests/integration/organization/collaboration-flag-dropped.test.ts`
- Modify: `prisma/schema.prisma`, `src/modules/organization/organization.repository.ts`, `src/modules/privacy/privacy.repository.ts`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: none added

## Security
- v5.0.0-15.3.1: the preflight message carries ids only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| objects gone | integration | AC-1, C-35 | no column, no function |
| preflight stops | integration | AC-2 | two flagged rows → error with two ids |
| preflight passes | integration | AC-3 | no flagged row → success |
| registered person | integration | AC-4, C-05 | ACTIVE row of a guest → 23514 |
| number released | integration | AC-5 | phone_number null → update succeeds |
| no silent loss | security | AB-1, CWE-778 | flagged row → migration stops first |

Command: `npx vitest run tests/integration/organization tests/integration/privacy`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/collaboration-table.test.ts | tests the flag rules, the trigger on people and lists the column | those cases removed; the registered-person cases stay; the column list without the flag |
| tests/integration/organization/close.test.ts | the seed helper and three assertions use `isPublicContact` | helper and assertions without it |
| tests/integration/organization/revoke.test.ts | seeds and asserts `isPublicContact` | seeds and assertions without it |
| tests/integration/organization/transfer.test.ts | seeds it and has the case 'leaves is_public_contact unchanged' | seeds without it; that case removed |
| tests/integration/organization/invite.test.ts | two assertions expect `isPublicContact: false` | assertions without it |
| tests/integration/organization/create.test.ts | expects `isPublicContact: false` on the OWNER row | expectation without it |
| tests/integration/organization/team-list.test.ts | the seed sets `isPublicContact` | seed without it |
| tests/integration/privacy/anonymize.test.ts | seeds the flag and expects it false after anonymization | seed and expectations without it |

## Out of scope
- Turning a flagged number into a contact: an owner's decision, open question.
