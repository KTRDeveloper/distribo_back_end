---
id: REL-004
title: Credit limit rules and journal trigger
module: relationship
kind: technical
rev: 2
amends: []
size: S
risk: high
depends_on: [REL-002, REL-003]
read_first: [prisma/schema.prisma, tests/integration/relationship/party-rules.test.ts]
design_refs: [relations-commerciales/customerrelationship, contraintes-a-poser-au-niveau-base-de]
constraints: [C-10]
asvs: [v5.0.0-2.2.3, v5.0.0-16.3.3]
---

# REL-004 — Credit limit rules and journal trigger

## Story
Technical story: enforce the credit limit rules and write the journal row from the database, so that no code path can change a limit without a trace.

## Context
- Exists: `customer_relationships` with `credit_limit` (nullable bigint), `credit_limit_set_by_id`, `credit_limit_set_at`; `credit_limit_changes` (REL-003).
- Adds: one migration. New rows get `credit_limit` 0 by default. CHECK: a counter (no customer) has `credit_limit = 0`; `credit_limit_set_by_id` and `credit_limit_set_at` are both null or both set; `credit_limit >= 0` when set.
- Trigger `AFTER UPDATE OF credit_limit`: when the value changes it inserts one `credit_limit_changes` row (`previous_limit` = old, `new_limit` = new, `set_by_id` = `credit_limit_set_by_id`, `set_at` = `now()`); the same statement must also change `credit_limit_set_by_id` (a change with an unchanged author is refused with 23514) and sets `credit_limit_set_at` to `now()`.
- `C-10`: `credit_limit` is 0 at creation and always 0 for a counter; `credit_limit_set_by_id` and `credit_limit_set_at` are set together; every change adds one `CreditLimitChange` row in the same transaction.

## Acceptance criteria
```gherkin
Scenario: AC-1 Default
  When a relationship is inserted without `credit_limit`
  Then `credit_limit` is 0 and no journal row exists
Scenario Outline: AC-2 Rules
  When a row has <values>
  Then the statement <result>
  Examples:
    | values                                                   | result          |
    | counter with credit_limit 10000                          | rejects (23514) |
    | credit_limit -1                                          | rejects (23514) |
    | credit_limit_set_by_id set, credit_limit_set_at empty    | rejects (23514) |
    | credit_limit empty (no ceiling) on a customer            | accepts         |
Scenario: AC-3 Journal from the database
  When an update sets `credit_limit` 50000 and `credit_limit_set_by_id` to a registered person
  Then one journal row has previous 0, new 50000, that author and a server time, and `credit_limit_set_at` is that time
Scenario: AC-4 Author must change with the value
  When an update changes `credit_limit` without changing `credit_limit_set_by_id`
  Then the update fails with 23514 and the value is unchanged
Scenario: AC-5 Same value is no change
  When an update sets the same `credit_limit`
  Then no journal row is added
Scenario: AC-6 Same transaction
  When the transaction rolls back
  Then neither the limit nor the journal row exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Silent limit change (repudiation)
  When code raises a limit and tries to avoid the journal
  Then the journal row exists anyway, or the update fails
```

## Implementation
- Create: `prisma/migrations/<timestamp>_rel_004_credit_limit_rules/migration.sql`, `tests/integration/relationship/credit-limit-rules.test.ts`
- Pattern: `tests/integration/relationship/party-rules.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: limit, author and time are checked together.
- v5.0.0-16.3.3: the journal is written by a trigger, so it cannot be skipped.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| default | integration | AC-1, C-10 | limit 0, no journal |
| rules | integration | AC-2, C-10 | each Examples row → accepted or 23514 |
| journal | integration | AC-3, C-10 | one row with previous, new, author, time |
| author changes | integration | AC-4 | 23514, unchanged |
| same value | integration | AC-5 | no row |
| transaction | integration | AC-6, CWE-362 | rollback → nothing |
| silent change | security | AB-1, CWE-778 | update without journal impossible |

Command: `npx vitest run tests/integration/relationship/credit-limit-rules.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/relationship/relationship-table.test.ts › "applies defaults and uses the expected column types" | it expects `credit_limit` null by default; AC-1 makes the default 0 | `credit_limit` is `0n`; every other expectation unchanged |
| tests/integration/relationship/relationship-table.test.ts › "accepts credit_limit_set_by_id of a registered person" | it sets `credit_limit_set_by_id` without `credit_limit_set_at`, which the new CHECK refuses with 23514 (AC-2) | `insertRelationship` also takes `creditLimitSetAt`; the row sets both, the author a registered person; still 1 row |
| tests/integration/relationship/relationship-table.test.ts › "rejects credit_limit_set_by_id of a guest with 23514" | without `credit_limit_set_at` the new pair CHECK answers 23514 first, so the guest rule is no longer what the test checks | the row also sets `credit_limit_set_at`; still 23514, now from the guest rule |

## Out of scope
- The route that changes a limit (REL-012).
