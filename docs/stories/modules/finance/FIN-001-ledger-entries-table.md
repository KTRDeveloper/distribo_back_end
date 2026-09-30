---
id: FIN-001
title: Ledger entries table
module: finance
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [REL-001, ORD-001, PER-008, FND-002, REL-014]
read_first: [prisma/schema.prisma, tests/integration/relationship/reassignment-table.test.ts]
design_refs: [finances/ledgerentry, contraintes-a-poser-au-niveau-base-de]
constraints: ['LedgerEntry:required', 'LedgerEntry.kind:enum', 'LedgerEntry.mode:enum', 'LedgerEntry:fk', 'LedgerEntry.balance_effect:generated', C-23, C-04, C-39]
asvs: [v5.0.0-8.3.1]
---

# FIN-001 — Ledger entries table

## Story
Technical story: create the immutable ledger table with a generated balance effect, so that the sign of an entry comes from its type and nobody can edit or delete a line.

## Context
- Exists: `customer_relationships`, `orders`, `require_registered_person()`, `set_server_updated_at()`, role `distribo_app`.
- Adds: table `ledger_entries` with `server_updated_at` only (no `deleted_at`, Q-015), foreign keys (`order_id`, `reverses_entry_id`, `recorded_by_id`), indexes on (`customer_relationship_id`, `occurred_at` desc), `order_id`, (`recorded_by_id`, `occurred_at`), triggers `require_registered_person('recorded_by_id')` and `set_server_updated_at()`, and `REVOKE UPDATE, DELETE, TRUNCATE ... FROM distribo_app`.
- `balance_effect` bigint is `GENERATED ALWAYS AS` (`CASE` on `kind`: SALE, OPENING_BALANCE and REFUND give `amount`, PAYMENT and CREDIT_NOTE give `-amount`; the sign flips when `reverses_entry_id` is not null) `STORED`.
- CHECKs: `amount > 0`; `mode` is not null exactly when `kind` is PAYMENT or REFUND.
- `LedgerEntry` fields: `customer_relationship_id` FK → CustomerRelationship; `order_id` FK → Order, nullable; `kind` enum [SALE / PAYMENT / REFUND / CREDIT_NOTE / OPENING_BALANCE]; `amount` bigint; `balance_effect` bigint, calculé par la base; `mode` enum [CASH / MOBILE_MONEY], nullable; `transaction_reference` string, nullable; `reverses_entry_id` FK → LedgerEntry, nullable; `recorded_by_id` FK → Person; `note` text, nullable; `occurred_at` datetime
- `LedgerEntry:required`: NOT NULL: `customer_relationship_id`, `kind`, `amount`, `recorded_by_id`, `occurred_at`
- `LedgerEntry.kind:enum`: one of SALE, PAYMENT, REFUND, CREDIT_NOTE, OPENING_BALANCE
- `LedgerEntry.mode:enum`: one of CASH, MOBILE_MONEY
- `LedgerEntry:fk`: references customer_relationship_id → CustomerRelationship; order_id → Order; reverses_entry_id → LedgerEntry; recorded_by_id → Person
- `LedgerEntry.balance_effect:generated`: computed by the database; never written by the application
- `C-23`: `LedgerEntry.amount` > 0; `balance_effect` is a generated column of `kind`, `amount` and `reverses_entry_id`; `mode` is set if and only if `kind` is PAYMENT or REFUND.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Balance effect
  When an entry of kind <kind> and amount 10000 is inserted <reversal>
  Then balance_effect is <effect>
  Examples:
    | kind            | reversal              | effect |
    | SALE            | as an original        | 10000  |
    | REFUND          | as an original        | 10000  |
    | PAYMENT         | as an original        | -10000 |
    | CREDIT_NOTE     | as an original        | -10000 |
    | PAYMENT         | reversing an entry    | 10000  |
Scenario Outline: AC-2 Amount and mode
  When a row has <values>
  Then the insert <result>
  Examples:
    | values                                | result          |
    | amount 0                              | rejects (23514) |
    | amount -5                             | rejects (23514) |
    | PAYMENT with mode CASH                | accepts         |
    | PAYMENT without mode                  | rejects (23514) |
    | SALE with mode CASH                   | rejects (23514) |
    | CREDIT_NOTE without mode              | accepts         |
Scenario: AC-3 Never written by the application
  When a row is inserted with an explicit balance_effect
  Then the insert fails
Scenario: AC-4 Immutable
  When the application account updates or deletes a row
  Then PostgreSQL answers permission denied (42501)
Scenario: AC-5 Keys and author
  When the relationship is unknown or `recorded_by_id` is a guest
  Then the insert fails with 23503 or 23514
```

## Abuse cases
```gherkin
Scenario: AB-1 Rewriting a payment (tampering)
  When code running as the application account changes a PAYMENT's amount from 30000 to 3000
  Then the update is refused and the row is unchanged
```

## Implementation
- Create: `prisma/migrations/<timestamp>_fin_001_ledger_entries/migration.sql`, `tests/integration/finance/ledger-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/relationship/reassignment-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-8.3.1: only INSERT and SELECT are granted to `distribo_app`.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| balance effect | integration | AC-1, LedgerEntry.balance_effect:generated, C-23 | each Examples row → effect |
| amount and mode | integration | AC-2, C-23, LedgerEntry.kind:enum, LedgerEntry.mode:enum | each Examples row → accepted or rejected |
| generated column | integration | AC-3 | explicit value → error |
| immutable | security | AC-4, AB-1, C-39, WSTG-ATHZ-03 | as `distribo_app`: UPDATE, DELETE → 42501 |
| keys and author | integration | AC-5, LedgerEntry:required, LedgerEntry:fk, C-04 | rejected; column types; server time |

Command: `npx vitest run tests/integration/finance/ledger-table.test.ts`

## Out of scope
- Sale, reversal and order rules (FIN-002).
