---
id: IMG-001
title: Registry of copied photos
module: images
kind: migration
rev: 1
amends: []
size: S
risk: high
depends_on: [FND-013]
read_first: [prisma/schema.prisma, prisma/migrations/20261004180000_adm_002_admin_actions/migration.sql]
design_refs: [images/imagecopy, contraintes-a-poser-au-niveau-base-de]
constraints: ['ImageCopy:required', C-56, C-39]
asvs: [v5.0.0-16.3.1]
---

# IMG-001 — Registry of copied photos

## Story
Technical story: create the registry that records every photo copied from another, so that all copies of one original can be found later, even re-encoded.

## Context
- Exists: nothing for photos in the database; keys are `products/<UUIDv4>.webp` (FND-013). Only product and variant photos are copied, never a logo or a profile photo.
- One migration creates `image_copies`: `copy_key` text primary key, `source_key` and `root_key` text not null, `copied_at` timestamptz not null default now(). Indexes on `root_key` and on `source_key`. No organization or person column: the registry names no one.
- Checks: all three keys start with `products/`; `copy_key` differs from `source_key` and from `root_key`.
- Trigger `image_copies_check_root` (23514): when the source is itself a copy, `root_key` equals that copy's `root_key`; otherwise `root_key` equals `source_key`. The database holds the rule because every later writer reuses it.
- GRANT: the application account gets INSERT and SELECT only; UPDATE, DELETE and TRUNCATE are revoked (C-39), as for `admin_actions`.
- `prisma/schema.prisma`: model `ImageCopy` and, above it, a plain-words `//` comment: the registry only grows, the root of a family never changes, and the migration that holds the rules.
- `ImageCopy` fields: `copy_key` string, PK; `source_key` string; `root_key` string; `copied_at` datetime
- `ImageCopy:required`: NOT NULL: `source_key`, `root_key`, `copied_at`
- `C-56`: `ImageCopy` has `copy_key` as primary key; `root_key` equals the source's `root_key` when the source is itself a copy, else the source key; written by the server only, in the transaction that stores the copy's key; never synchronized; never updated, deleted or purged.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.

## Acceptance criteria
```gherkin
Scenario: AC-1 A first copy
  When a copy B of the original A is inserted with root A
  Then the row is stored and `copied_at` is the insert time
Scenario: AC-2 A copy of a copy
  Given B is a copy of A
  When C is inserted with source B and root A
  Then the row is stored, and one query on root A returns B and C
Scenario Outline: AC-3 Wrong rows are refused
  When a row is inserted with <problem>
  Then the database refuses it with <code>
  Examples:
    | problem                     | code  |
    | root B for a copy of copy B | 23514 |
    | root C for a copy of A      | 23514 |
    | copy equal to source        | 23514 |
    | a key under logos/          | 23514 |
    | a null source               | 23502 |
    | an existing copy key        | 23505 |
Scenario: AC-4 The registry only grows
  When the application account updates, deletes or truncates the table
  Then each statement fails with 42501
```

## Abuse cases
```gherkin
Scenario: AB-1 The registry is rewritten to hide a family (tampering)
  When the application account changes a `root_key`
  Then the database refuses with 42501 and the family is unchanged
```

## Implementation
- Create: `prisma/migrations/<timestamp>_img_001_image_copies/migration.sql`, `tests/integration/images/image-copy-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-16.3.1: the registry is insert-only for the application account, so the history of copies cannot be rewritten.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| first copy | integration | AC-1, C-56 | insert B from A → stored, date set |
| copy of copy | integration | AC-2, C-56 | insert C from B with root A → one query on root A returns B and C |
| wrong rows | integration | AC-3, ImageCopy:required | each Examples row → the code |
| insert only | integration | AC-4, C-39 | UPDATE, DELETE, TRUNCATE as the application role → 42501 |
| rewrite | security | AB-1, CWE-284 | UPDATE root_key as the application role → 42501, row unchanged |

Command: `npx vitest run tests/integration/images/image-copy-table.test.ts`

## Out of scope
- Writing rows: IMG-006.
- Reading the registry from the administration area (moderation is postponed to v2).
