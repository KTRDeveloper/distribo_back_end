---
id: CAT-018
title: Two variants of a product never share a name and a unit
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [CAT-012]
read_first: [prisma/schema.prisma, tests/integration/organization/organization-table.test.ts]
design_refs: [catalogue/productvariant, contraintes-a-poser-au-niveau-base-de]
constraints: [C-47, C-35]
asvs: [v5.0.0-2.2.1]
---

# CAT-018 — Two variants of a product never share a name and a unit

## Story
Technical story: forbid, in the database, two live variants of one product with the same name and unit, and a merged variant that is not deleted, so that a customer never sees the same article twice.

## Context
- Exists: `product_variants` (CAT-012) with `name` (empty allowed), `unit`, `merged_into_id` and `deleted_at`.
- One migration, one transaction. Unique index (C-47) on (`product_id`, simplified name, simplified unit) where `deleted_at` is empty. Simplified text is `lower(btrim(regexp_replace(coalesce(x, ''), '[ \t\r\n]+', ' ', 'g')))`: capitals and extra spaces ignored, an empty name equals the empty text, nothing else guessed.
- CHECK: `merged_into_id` set means `deleted_at` is set. The code that merges variants (a later story) deletes and points in one write.
- `prisma/schema.prisma`: the unique index cannot be written as `@@unique` (it uses text functions and ignores deleted rows), so the `//` comment above `ProductVariant` gains, in plain words: one live variant per name and unit, compared without capitals or extra spaces, and a merged variant is always deleted.
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 One name and unit per product
  Given a live variant of a product with name <n1> and unit <u1>
  When another variant of <product> gets name <n2> and unit <u2>
  Then the insert <result>
  Examples:
    | n1        | u1        | product | n2        | u2         | result          |
    | empty     | sac 10 kg | same    | empty     | Sac  10 kg | rejects (23505) |
    | Rouge / L | piece     | same    | rouge / l | PIECE      | rejects (23505) |
    | empty     | sac 10 kg | same    | empty     | sac 10kg   | accepts         |
    | Rouge / L | piece     | same    | Bleu / M  | piece      | accepts         |
    | Rouge / L | piece     | other   | Rouge / L | piece      | accepts         |
Scenario: AC-2 A deleted variant frees its name and unit
  Given a deleted variant with name "Rouge / L" and unit "piece"
  When another variant of the same product gets the same name and unit
  Then the insert is accepted
Scenario Outline: AC-3 A merged variant is deleted
  When a variant has <values>
  Then the database <result>
  Examples:
    | values                               | result          |
    | merged_into_id set, deleted_at set   | accepts         |
    | merged_into_id set, deleted_at empty | rejects (23514) |
    | merged_into_id empty, deleted_at empty | accepts       |
```

## Abuse cases
```gherkin
Scenario: AB-1 The same article listed twice by concurrent writes (tampering)
  When two transactions insert the same name and unit for one product at the same time
  Then exactly one succeeds and the other fails with 23505
```

## Implementation
- Create: `prisma/migrations/<timestamp>_cat_018_variant_name_unit/migration.sql`, `tests/integration/catalog/variant-name-unit.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.1: the uniqueness is enforced by the database, so concurrent writes cannot both pass an application check.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| name and unit | integration | AC-1, C-47 | each Examples row → accepted or 23505 |
| deleted frees | integration | AC-2, C-35 | deleted then re-added → accepted |
| merged | integration | AC-3, C-47 | each Examples row → accepted or 23514 |
| concurrent | security | AB-1, CWE-362 | two parallel inserts → one 23505 |

Command: `npx vitest run tests/integration/catalog/variant-name-unit.test.ts`

## Out of scope
- Merging two variants into one: a later story.
- A TypeScript twin of the simplified text (CAT-016).
