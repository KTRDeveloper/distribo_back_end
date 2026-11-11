---
id: SYNC-047
title: Relationship rows carry the other side's public name
module: sync
kind: change
rev: 1
amends: [SYNC-004]
size: S
risk: medium
depends_on: [SYNC-004]
read_first: [src/modules/sync/adapters/relationship.adapter.ts, src/modules/sync/sync.changes.ts]
design_refs: [a5-nom-public-du-client-chez-le, a6-nom-public-du-fournisseur-chez-le]
constraints: []
asvs: [v5.0.0-15.3.1, v5.0.0-15.3.3]
---

# SYNC-047 — Relationship rows carry the other side's public name

## Story
As a seller, I want each relationship on my phone to carry the customer's public name, so that a customer I gave no label still has a name.

## Context
- `toSyncRow` (relationship.adapter.ts) adds one field, computed at each pull and never stored:
  - supplier and driver rows: `customer_public_name` = the customer organization's `name`, else the customer person's `full_name`, else null;
  - the customer person's row: `supplier_public_name` = the supplier organization's `name`, else the invited supplier person's `full_name`, else null.
- Never from `customer_label` or `supplier_label`; each side gets only its own field.
- `WITH_PARTIES` also loads the supplier person and the supplier organization's `name`.
- Both fields join the `customer_relationships` computed list in `sync.judge.ts`, so a phone never writes them.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The customer's public name for the supplier team
  Given a relationship whose customer is <customer>, with customer_label "Tata"
  When an OWNER and a DRIVER of the supplier pull relationships
  Then both rows have customer_public_name <name> and no supplier_public_name
  Examples:
    | customer                         | name            |
    | organization "Boutique Test"     | "Boutique Test" |
    | person with full_name "Awa Kone" | "Awa Kone"      |
    | person without full_name         | null            |
Scenario Outline: AC-2 The supplier's public name for the customer
  Given a relationship of customer person P with supplier <supplier>, with supplier_label "Mon grossiste"
  When P pulls relationships
  Then the row has supplier_public_name <name> and no customer_public_name
  Examples:
    | supplier                                  | name         |
    | organization "Dépôt Test"                 | "Dépôt Test" |
    | invited person with full_name "Paul Test" | "Paul Test"  |
    | invited person without full_name          | null         |
```

## Abuse cases
```gherkin
Scenario: AB-1 A phone writes a public name
  When a phone pushes a relationship update with customer_public_name "Faux nom"
  Then nothing is stored from it and the next pull returns the real name
```

## Implementation
- Create: `tests/integration/sync/relationship-public-names.test.ts`
- Modify: `src/modules/sync/adapters/relationship.adapter.ts`, `src/modules/sync/sync.judge.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-15.3.1: explicit fields per viewer; the private labels never feed a public name.
- v5.0.0-15.3.3: both names are server-computed, never written by a phone.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| customer name | integration | AC-1 | each Examples row, OWNER and DRIVER rows |
| supplier name | integration | AC-2 | each Examples row |
| written by a phone | security | AB-1, WSTG-BUSL-01 | ignored, real name pulled |

Command: `npx vitest run tests/integration/sync/relationship-public-names.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-relationships.test.ts | one computed field is added to relationship rows | unchanged: passes without edits |

## Out of scope
- Sending rows again after a rename (REL-033).
