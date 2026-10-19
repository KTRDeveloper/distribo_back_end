---
id: ORG-032
title: The business email column is dropped
module: organization
kind: migration
rev: 1
amends: [ORG-001]
size: S
risk: high
depends_on: [ORG-028, ORG-039]
read_first: [src/modules/organization/organization.repository.ts, tests/integration/organization/organization-table.test.ts]
design_refs: [identite-et-organisation/organization, contraintes-a-poser-au-niveau-base-de]
constraints: [C-35]
asvs: [v5.0.0-15.3.1]
---

# ORG-032 — The business email column is dropped

## Story
Technical story: drop `organizations.email`, now replaced by the business contacts, without losing a value nobody has decided about.

## Context
- Exists: `organizations.email` (ORG-001), no longer written (ORG-028) nor sent to phones (ORG-039).
- Migration `prisma/migrations/<timestamp>_org_032_drop_organization_email/migration.sql`. First statement, a preflight `DO` block: if any live organization has an `email`, raise an error whose message lists the ids of those organizations only (at most 20, comma separated; never an address) and ends with "decide before dropping: see OPEN_QUESTIONS". Nothing is converted into a contact here: whether a stored address becomes a pending EMAIL contact is for the owners to decide.
- Second statement: `ALTER TABLE organizations DROP COLUMN email`. Update `prisma/schema.prisma` (remove the field; the `//` comment above `Organization` must not mention it) and remove the leftover `email` from `CreatedOrganization` and every `select` in `organization.repository.ts`.
- Test of the preflight: in a transaction, create a scratch schema holding a table `organizations(id uuid, email text)`, put it first in `search_path` with `SET LOCAL`, run the first statement of the migration file, then roll back.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 The column is gone
  When the columns of `organizations` are read
  Then there is no `email` column and the other columns are unchanged
Scenario: AC-2 The preflight stops on a stored address
  Given the scratch table holds two rows with an email and one without
  When the preflight runs
  Then it raises an error listing the two ids and no address
Scenario: AC-3 The preflight passes on a clean table
  Given the scratch table holds only rows without email
  When the preflight runs
  Then it succeeds
Scenario: AC-4 The application still reads and writes organizations
  When a business is created and read through the API
  Then the answer is the one ORG-028 describes
```

## Abuse cases
```gherkin
Scenario: AB-1 A stored address vanishes without a decision (repudiation)
  Given an organization with an email
  When the migration is applied
  Then it stops before dropping the column and names the organization by id only
```

## Implementation
- Create: `prisma/migrations/<timestamp>_org_032_drop_organization_email/migration.sql`, `tests/integration/organization/organization-email-dropped.test.ts`
- Modify: `prisma/schema.prisma`, `src/modules/organization/organization.repository.ts`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: none added

## Security
- v5.0.0-15.3.1: the preflight message carries ids and no personal data.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| column gone | integration | AC-1, C-35 | information_schema has no email, the other columns stay |
| preflight stops | integration | AC-2 | two rows with email → error with two ids, no address |
| preflight passes | integration | AC-3 | clean table → success |
| create and read | integration | AC-4 | creation and reading still work |
| no silent loss | security | AB-1, CWE-778 | stored email → migration text stops before the DROP |

Command: `npx vitest run tests/integration/organization/organization-email-dropped.test.ts tests/integration/organization/organization-table.test.ts tests/integration/organization/actor-and-read.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/organization-table.test.ts | selects `email` and lists it among the nullable columns | no `email` in the select, the object and the loop |
| tests/integration/organization/actor-and-read.test.ts | the seed writes `email: 'org@example.cm'` and the `Detail` type has it | seed and type without `email` |

## Out of scope
- Turning a stored address into a contact: an owner's decision, open question.
