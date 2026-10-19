---
id: CAT-016
title: Variant label and comparison text shared by the app and the server
module: catalog
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [CAT-018]
read_first: [src/shared/money.ts, tests/unit/shared/money.test.ts]
design_refs: [catalogue/productvariant]
constraints: [C-47]
asvs: [v5.0.0-2.2.1]
---

# CAT-016 — Variant label and comparison text shared by the app and the server

## Story
Technical story: one function composes the label of a variant and one function simplifies a text for comparison, the same for the phone and the server, so that an order line and a duplicate check never differ between them.

## Context
- Exists: `src/shared/` holds code without Node-only imports (`money.ts`, `ids.ts`). The unique index of CAT-018 compares names and units in SQL.
- `variantLabel(productName, variantName, unit)`: the product name, then " \u2014 " (space, em dash, space), then the unit; with a variant name, the name then the unit in parentheses: "Riz \u2014 sac 50 kg", "T-shirt \u2014 Rouge / L (piece)". A variant name that is null or empty counts as no name. Nothing else is changed: no trimming, no case change (names stay as typed).
- `simplifyText(text)`: the comparison form. Null becomes empty; each run of space, tab, carriage return and line feed becomes one space; spaces at both ends go; then lower case. It is the SQL expression of CAT-018, `lower(btrim(regexp_replace(coalesce(x, ''), '[ \t\r\n]+', ' ', 'g')))`.
- The TypeScript twin never uses `trim()`, which also removes characters (a non-breaking space) that PostgreSQL keeps. Tests compare ASCII letters only: lower case of other letters depends on the database collation.
- Adds `src/shared/variant.ts` with no import. First usage: order lines freeze the label (ORD) and the catalog tells "already in your catalog" and merges duplicates. It ships here because both modules import it (ADR-004).
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Label
  When `variantLabel("<product>", <variant>, "<unit>")` is called
  Then the result is "<label>"
  Examples:
    | product | variant   | unit      | label                      |
    | Riz     | null      | sac 50 kg | Riz \u2014 sac 50 kg        |
    | T-shirt | "Rouge/L" | piece     | T-shirt \u2014 Rouge/L (piece) |
    | Riz     | ""        | sac 50 kg | Riz \u2014 sac 50 kg        |
Scenario Outline: AC-2 Comparison text
  When `simplifyText(<input>)` is called
  Then the result is <result>
  Examples:
    | input             | result       |
    | "Sac 10 kg"       | "sac 10 kg"  |
    | "  sac   10 kg "  | "sac 10 kg"  |
    | "sac 10kg"        | "sac 10kg"   |
    | "\tRiz\n\r"      | "riz"        |
    | null              | ""           |
    | "a\u00a0"         | "a\u00a0"    |
Scenario: AC-3 The function agrees with the database
  Given pairs of names and units, among them the rows of AC-2
  When two variants of one product are inserted for each pair
  Then the second insert fails with 23505 exactly when `simplifyText` gives the same result for the names and for the units
Scenario: AC-4 The file imports nothing
  When the source of `src/shared/variant.ts` is read
  Then it has no `import` and no `require`
```

## Abuse cases
```gherkin
Scenario: AB-1 A huge name stalls the server (resource exhaustion)
  When `simplifyText` receives a million spaces followed by one letter
  Then it returns in under one second
```

## Implementation
- Create: `src/shared/variant.ts`, `tests/unit/shared/variant.test.ts`, `tests/integration/catalog/variant-text.test.ts`
- Pattern: `tests/unit/shared/money.test.ts`
- Signatures:
  - `variantLabel(productName: string, variantName: string | null, unit: string): string`
  - `simplifyText(text: string | null): string`
- Dependencies: none added

## Security
- v5.0.0-2.2.1: the comparison the code uses to reject a duplicate is the one the database enforces, so a check never passes in code and fails in storage.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| label | unit | AC-1 | each Examples row → label |
| comparison | unit | AC-2, C-47 | each Examples row → simplified text |
| database twin | integration | AC-3, C-47 | pairs inserted → 23505 exactly when the texts match |
| no import | unit | AC-4 | source has no import |
| huge input | security | AB-1, CWE-1333 | one million spaces and a letter → under one second |

Command: `npx vitest run tests/unit/shared/variant.test.ts tests/integration/catalog/variant-text.test.ts`

## Out of scope
- Showing, merging or checking duplicates: the stories that use these functions.
- Upper case and accents beyond ASCII letters: the database collation decides, the design says nothing more.
