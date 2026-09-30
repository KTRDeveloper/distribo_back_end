---
id: REL-025
title: Merge a duplicate customer record
module: relationship
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [REL-007]
read_first: [src/modules/relationship/relationship.repository.ts, tests/integration/relationship/party-rules.test.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, relations-commerciales/customerrelationship]
constraints: [C-07, C-06, C-35]
asvs: [v5.0.0-2.3.3, v5.0.0-2.3.4]
---

# REL-025 — Merge a duplicate customer record

## Story
Technical story: provide the function that folds a customer record created twice offline into the first one, so that the sync server never blocks on a duplicate.

## Context
- Exists: `ensureCustomerRelationship`, the pair index (REL-002).
- Adds to `relationship.repository.ts`: `mergeDuplicateRelation(tx, duplicateId, keptId)` and `resolveMergedRelation(id, tx?)`.
- Merge: both rows must have the same supplier organization and resolve to the same person (or the duplicate's `customer_phone_number` normalizes to the kept row's person number); the duplicate gets `deleted_at` = now, `merged_into_id` = kept id and its `customer_phone_number` emptied. The kept row keeps all its settings. No ledger entry or order is rewritten.
- `resolveMergedRelation` follows `merged_into_id` (at most 5 hops) and returns the live id; an id that is not merged returns itself.
- `C-07`: At most one live relationship per (supplier, customer) pair, ignoring deleted and merged rows (partial unique indexes per column combination); `supplier_organization_id` differs from `customer_organization_id`; `merged_into_id` set means the row is deleted.
- `C-06`: A relationship has exactly one supplier (organization or person); at most one customer (person or organization), none only for a counter, and then `customer_label` is required; `customer_phone_number` is empty once `customer_person_id` is set.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Merge
  Given two live relationships of one supplier for one person
  When mergeDuplicateRelation runs
  Then the duplicate is deleted with merged_into_id set and the kept row is unchanged
Scenario: AC-2 Resolve
  Then resolveMergedRelation(duplicateId) returns the kept id and resolveMergedRelation(keptId) returns itself
Scenario Outline: AC-3 Refusals
  When the pair is <case>
  Then mergeDuplicateRelation throws `httpError(409, 'CANNOT_MERGE', ...)` and changes nothing
  Examples:
    | case                                         |
    | from two different suppliers                 |
    | for two different people                     |
    | a counter                                    |
    | the same row twice                           |
Scenario: AC-4 Atomic and repeatable
  When the merge runs twice, or its transaction rolls back
  Then the second run changes nothing, or nothing changed at all
```

## Abuse cases
```gherkin
Scenario: AB-1 Merging two identities (tampering)
  When a merge is tried between relationships of two different people
  Then it is refused and both stay live
```

## Implementation
- Create: `tests/integration/relationship/merge-duplicate.test.ts`
- Modify: `src/modules/relationship/relationship.repository.ts`
- Pattern: `src/modules/relationship/relationship.repository.ts`
- Signatures:
  - `mergeDuplicateRelation(tx: Prisma.TransactionClient, duplicateId: string, keptId: string): Promise<void>`
  - `resolveMergedRelation(id: string, tx?: Prisma.TransactionClient): Promise<string>`
- Errors: `CANNOT_MERGE` 409
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: the merge is one transaction.
- v5.0.0-2.3.4: the duplicate is locked (`SELECT ... FOR UPDATE`) before it is changed.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| merge | integration | AC-1, C-07, C-35 | deleted, merged_into_id, kept unchanged |
| resolve | integration | AC-2 | kept id; itself |
| refusals | integration | AC-3, C-06 | each Examples row → CANNOT_MERGE |
| repeat and rollback | integration | AC-4, CWE-362 | idempotent; rolled back leaves nothing |
| two identities | security | AB-1, CWE-841 | refused |

Command: `npx vitest run tests/integration/relationship/merge-duplicate.test.ts`

## Out of scope
- Detecting duplicates on a sync push and redirecting incoming rows (SYNC module).
