---
id: REL-027
title: The contested mark column and the end of the one-contestation rule
module: relationship
kind: migration
rev: 1
amends: [REL-001, REL-014]
size: S
risk: high
depends_on: [REL-014, REL-023]
read_first: [prisma/schema.prisma]
design_refs: [relations-commerciales/customerrelationship, relations-commerciales/customerrelationshipreassignment]
constraints: [C-57, C-12]
asvs: [v5.0.0-15.3.3, v5.0.0-2.3.3]
---

# REL-027 — The contested mark column and the end of the one-contestation rule

## Story
As a customer, I want a contestation to leave a mark on the record instead of moving it so that I can take it back myself and the supplier keeps the debt.

## Context
- Exists: `customer_relationships` (REL-001) and the reassignment journal (REL-014), whose partial unique index allows one contestation per relationship and previous person (an entry whose author is the previous person).
- Change, one migration `rel_027_contested_at`: add `contested_at timestamptz NULL` to `customer_relationships` (Prisma field `contestedAt`, `@map("contested_at")`); add a CHECK that `contested_at` is empty when the relationship is a counter (no customer person and no customer organization); drop the partial unique index of the journal, since a contestation no longer writes a journal entry.
- Additive and looser: no backfill. Existing rows get `contested_at` NULL. Past contestation entries stay in the journal (it is immutable); relationships already moved to a ghost person are left as they are (Q-049).
- `schema.prisma`: add a `//` line above `CustomerRelationship` for the counter rule and its migration; in the comment above `CustomerRelationshipReassignment`, replace the contestation paragraph by one saying the journal now holds only supplier corrections and the one-contestation rule was dropped by this migration.
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.
- `C-12`: A reassignment has previous and new person set; the new person has no relationship with the same supplier; the journal is never modified.
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.
- `C-12`: A reassignment has previous and new person set; the new person has no relationship with the same supplier; the journal is never modified.

## Acceptance criteria
```gherkin
Scenario: AC-1 Column
  When the migration has run
  Then `customer_relationships.contested_at` exists, is a nullable timestamptz, and every existing row has it NULL
Scenario: AC-2 Counter stays unmarked
  When `contested_at` is set on a counter
  Then the database refuses the update with a check violation (23514)
Scenario: AC-3 Person customer can be marked
  When `contested_at` is set on a relationship with a customer person
  Then the update succeeds
Scenario: AC-4 No more one-contestation index
  When two journal entries are inserted for the same relationship whose author is the previous person
  Then both are accepted
```

## Abuse cases
```gherkin
Scenario: AB-1 Erasing history (repudiation)
  When the application account tries to update or delete a journal entry
  Then it is still refused: the migration keeps the journal insert and select only
```

## Implementation
- Create: `prisma/migrations/<timestamp>_rel_027_contested_at/migration.sql`, `tests/integration/relationship/contested-at-column.test.ts`
- Modify: `prisma/schema.prisma`, `tests/integration/relationship/reassignment-table.test.ts`
- Pattern: `tests/integration/relationship/default-counter.test.ts`
- Dependencies: `@prisma/client`, `prisma`

## Security
- v5.0.0-15.3.3: `contested_at` is a server field; no request schema lists it (REL-028, REL-029 write it).
- v5.0.0-2.3.3: the column, the CHECK and the index drop are one migration.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| column | integration | AC-1, C-57 | information_schema → nullable timestamptz, existing rows NULL |
| counter | integration | AC-2, C-57 | set on a counter → 23514 |
| person customer | integration | AC-3 | set on a person relationship → ok |
| index dropped | integration | AC-4, C-12 | two self-authored entries → both inserted |
| immutable | security | AB-1, CWE-284 | update or delete journal entry → refused |

Command: `npx vitest run tests/integration/relationship/contested-at-column.test.ts tests/integration/relationship/reassignment-table.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/relationship/reassignment-table.test.ts | contestation rule (AC-3 of REL-014): the partial unique index is dropped | a second self-authored entry for the same relationship and person is accepted |

## Out of scope
- Writing the mark: REL-028 and REL-029; clearing it on correction: REL-031.
- Repairing relationships already moved to a ghost person (Q-049).
