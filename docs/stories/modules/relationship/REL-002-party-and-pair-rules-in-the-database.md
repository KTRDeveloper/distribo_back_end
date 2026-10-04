---
id: REL-002
title: Party and pair rules in the database
module: relationship
kind: technical
rev: 2
amends: []
size: S
risk: high
depends_on: [REL-001]
read_first: [prisma/schema.prisma, tests/integration/relationship/relationship-table.test.ts]
design_refs: [relations-commerciales/customerrelationship, contraintes-a-poser-au-niveau-base-de]
constraints: [C-06, C-07, C-08, C-09]
asvs: [v5.0.0-2.2.3, v5.0.0-8.2.2]
---

# REL-002 — Party and pair rules in the database

## Story
Technical story: enforce who the parties are, one live relationship per pair, and the PENDING and ENDED rules with CHECKs and partial unique indexes.

## Context
- Exists: `customer_relationships` (REL-001).
- Adds: one migration with CHECKs and partial unique indexes over live rows (`deleted_at` is null and `merged_into_id` is null).
- Party rules: exactly one of `supplier_organization_id` and `supplier_person_id`; at most one of `customer_person_id` and `customer_organization_id`; no customer means `customer_label` is set; `customer_phone_number` is null when `customer_person_id` is set; `supplier_organization_id <> customer_organization_id`.
- Pair rules: unique live (`supplier_organization_id`, `customer_person_id`), (`supplier_organization_id`, `customer_organization_id`), (`supplier_person_id`, `customer_person_id`), (`supplier_person_id`, `customer_organization_id`); `merged_into_id` set requires `deleted_at` set.
- State rules: `status = 'PENDING'` if and only if `supplier_person_id` is set; `ended_by_party` is set if and only if `status = 'ENDED'`.
- `C-06`: A relationship has exactly one supplier (organization or person); at most one customer (person or organization), none only for a counter, and then `customer_label` is required; `customer_phone_number` is empty once `customer_person_id` is set.
- `C-07`: At most one live relationship per (supplier, customer) pair, ignoring deleted and merged rows (partial unique indexes per column combination); `supplier_organization_id` differs from `customer_organization_id`; `merged_into_id` set means the row is deleted.
- `C-08`: `status` is PENDING if and only if `supplier_person_id` is set.
- `C-09`: `ended_by_party` is set if and only if `status` is ENDED; only that party may reopen the relationship.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Parties
  When a row has <values>
  Then the insert <result>
  Examples:
    | values                                                          | result          |
    | supplier organization and customer person                       | accepts         |
    | both supplier columns set                                       | rejects (23514) |
    | no supplier                                                     | rejects (23514) |
    | customer person and customer organization                       | rejects (23514) |
    | no customer, customer_label "Client de passage"                 | accepts         |
    | no customer, customer_label empty                               | rejects (23514) |
    | customer_person_id and customer_phone_number both set           | rejects (23514) |
    | supplier and customer organization equal                        | rejects (23514) |
Scenario Outline: AC-2 One live relationship per pair
  When a second row for the same pair is inserted while the first is <first>
  Then the insert <result>
  Examples:
    | first                       | result          |
    | live                        | rejects (23505) |
    | deleted                     | accepts         |
    | merged into another row     | accepts         |
Scenario: AC-3 Two counters
  When one organization has two counters with different labels
  Then both are accepted
Scenario Outline: AC-4 Status rules
  When a row has <values>
  Then the insert <result>
  Examples:
    | values                                        | result          |
    | PENDING with a supplier person                | accepts         |
    | PENDING with a supplier organization          | rejects (23514) |
    | ACTIVE with a supplier person                 | rejects (23514) |
    | ENDED with ended_by_party CUSTOMER            | accepts         |
    | ENDED with ended_by_party empty               | rejects (23514) |
    | ACTIVE with ended_by_party SUPPLIER           | rejects (23514) |
    | merged_into_id set and deleted_at empty       | rejects (23514) |
```

## Abuse cases
```gherkin
Scenario: AB-1 Crafted duplicate relationship (tampering)
  When code inserts a second live relationship for a pair
  Then PostgreSQL refuses it, even though no validation ran
```

## Implementation
- Create: `prisma/migrations/<timestamp>_rel_002_party_rules/migration.sql`, `tests/integration/relationship/party-rules.test.ts`
- Pattern: `tests/integration/relationship/relationship-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: related columns are checked together in the database.
- v5.0.0-8.2.2: one live row per pair prevents a second, differently scoped copy of the account.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| parties | integration | AC-1, C-06 | each Examples row → accepted or 23514 |
| pair rule | integration | AC-2, C-07 | each Examples row → accepted or 23505 |
| two counters | integration | AC-3, C-07 | both accepted |
| state rules | integration | AC-4, C-08, C-09 | each Examples row → accepted or 23514 |
| crafted duplicate | security | AB-1, CWE-20 | raw second live row → 23505 |

Command: `npx vitest run tests/integration/relationship/party-rules.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/relationship/relationship-table.test.ts › "rejects an unknown merged_into_id with 23503 and accepts an existing one" | its rows set `merged_into_id` with `deleted_at` null, and its second row has neither customer nor `customer_label`, so the new CHECKs answer 23514 first | `insertRelationship` also takes `deletedAt` and `customerLabel`; both rows set `deleted_at`, the second also sets `customer_label`; still 23503 for the unknown id and 1 row for the existing one |

## Out of scope
- Credit limit rules (REL-004).
