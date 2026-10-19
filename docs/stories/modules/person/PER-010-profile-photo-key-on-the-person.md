---
id: PER-010
title: Profile photo key on the person
module: person
kind: migration
rev: 1
amends: [PER-002, PER-003]
size: S
risk: high
depends_on: [PER-003]
read_first: [prisma/schema.prisma, tests/integration/person/person-repository.test.ts]
design_refs: [identite-et-organisation/person, contraintes-a-poser-au-niveau-base-de]
constraints: [C-02, C-49]
asvs: [v5.0.0-2.2.3]
---

# PER-010 — Profile photo key on the person

## Story
Technical story: add the column that holds the key of a person's profile photo, with the database rules that keep it empty for a guest and for an anonymized person and unique among people.

## Context
- Exists: `people` with the PER-002 columns and the PER-003 CHECKs; no photo column.
- Adds one migration, run in one transaction: `avatar_key` (text, empty by default) with a unique index, a CHECK that a guest (empty `registered_at`) has no key, and a CHECK that an anonymized person has no key (C-02).
- Every existing row keeps an empty key, so the new rules already hold: no backfill and no audit are needed.
- The key is written by the server only (C-49): PER-013 adds the writer and IMG-003 the route. Nothing else writes the column.
- A key cited by one card only across all tables (people, organizations, products, variants) cannot be a rule of one table: the images module checks it (IMG-004, IMG-006).
- `prisma/schema.prisma`: add the field `avatarKey` to `model Person` (`String?`, `@unique`, `@map("avatar_key")`) and add to the `//` comment block above `model Person` a plain-language entry: a guest has no profile photo; an anonymized person has none; one photo file belongs to one person; the rule across tables is kept by the images module; migration name `per_010_person_avatar_key`.
- `Person` fields: `avatar_key` string, nullable
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` and `avatar_key` are empty.
- `C-49`: A guest has no `avatar_key`; a key is cited by one card only, across all tables; `Person.avatar_key` is written by the server only. The rules for product and variant keys belong to the images and catalog modules.

## Acceptance criteria
```gherkin
Scenario: AC-1 Empty by default
  When a person is inserted without mentioning `avatar_key`
  Then the stored `avatar_key` is empty
Scenario Outline: AC-2 Photo key rules
  When a row is inserted directly with <values>
  Then the database <result>
  Examples:
    | values                                      | result          |
    | registered person with a key                | accepts         |
    | registered person without a key             | accepts         |
    | guest with a key                            | rejects (23514) |
    | anonymized person with a key                | rejects (23514) |
Scenario: AC-3 One file, one person
  Given a registered person holds a key
  When another person is given the same key
  Then the database rejects it with 23505
  And any number of people may have an empty key
Scenario: AC-4 Anonymizing removes the key
  Given a registered person holds a key
  When the person is set to ANONYMIZED and the key is left in place
  Then the database rejects the update with 23514
  And the same update that also empties the key is accepted
```

## Abuse cases
```gherkin
Scenario: AB-1 A photo kept where none is allowed (information disclosure)
  When code gives a key to a guest, straight in the database
  Then PostgreSQL rejects it with 23514, even though no application check ran
```

## Implementation
- Create: `prisma/migrations/<timestamp>_per_010_person_avatar_key/migration.sql`, `tests/integration/person/person-avatar-checks.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/person/person-repository.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: related columns (`status`, `registered_at`, `avatar_key`) are checked together in the database, not only in code.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| empty by default | integration | AC-1 | insert without a key → NULL |
| key rules | integration | AC-2, C-02 | each Examples row → accepted or 23514 |
| one file one person | integration | AC-3, C-49 | same key on two people → 23505; two empty keys → accepted |
| anonymized without key | integration | AC-4, C-02 | status ANONYMIZED with the key kept → 23514; with the key emptied → accepted |
| no validation bypass | security | AB-1, CWE-20 | raw update giving a key to a guest → 23514 |

Command: `npx vitest run tests/integration/person/person-avatar-checks.test.ts tests/integration/person/person-table.test.ts tests/integration/person/person-checks.test.ts`

## Out of scope
- The writer of the key (PER-013) and the upload routes (IMG-003).
- Showing the photo address (PER-011, PER-012).
- Emptying the key and deleting the file when a person is anonymized: a change story of the privacy module. Until it ships, anonymizing a person who has a photo fails on the CHECK.
- The rule that a key is cited by one card only across tables (IMG-004, IMG-006).
