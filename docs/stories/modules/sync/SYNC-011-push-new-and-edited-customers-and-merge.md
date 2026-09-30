---
id: SYNC-011
title: Push new and edited customers, and merge duplicates
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-010, REL-025, REL-007, SYNC-004]
read_first: [src/modules/relationship/relationship.repository.ts, src/modules/sync/sync.judge.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, relations-commerciales/customerrelationship/entree-en-relation-le-numero-comme]
constraints: [C-36, C-06]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-2.4.1]
---

# SYNC-011 — Push new and edited customers, and merge duplicates

## Story
As a seller, I want a customer I added offline to be resolved by the server without duplicates so that no phone is ever blocked.

## Context
- Exists: judge pipeline (SYNC-010); `findOrCreateByPhone`, `ensureCustomerRelationship`, `mergeDuplicateRelation`, `resolveMergedRelation` (REL-025).
- Adds: `adapters/relationship.push.ts` registering the push side of `customer_relationships`.
- Create (SELLER and above): the row carries `id`, `customer_phone_number`, `customer_label`, `delivery_address`; the supplier is the viewer's organization from the row's `supplier_organization_id` (checked by scope); credit limit 0, balance 0, status ACTIVE; a counter (no customer number) is forbidden here (`COUNTER_ONLINE_ONLY`). The number is normalized; an invalid one makes the line an `issue` with code `INVALID_PHONE` and it is not stored. The server finds or creates the person, sets `customer_person_id`, empties `customer_phone_number`.
- Duplicate: when the organization already has a live relationship with that person, the new row is merged into the existing one (`mergeDuplicateRelation`); an info issue `MERGED` ("<label> ajoutée deux fois : fiches réunies") is reported and later pushed rows that name the duplicate id are redirected to the surviving id for the rest of the batch.
- Update: `customer_label`, `delivery_address`, `supplier_notes` (a SELLER may write these; others are forbidden by SYNC-010).
- `C-36`: No uniqueness rule makes a sync fail; every possible duplicate has a written behavior, and a line no rule can write is set aside.
- `C-06`: A relationship has exactly one supplier (organization or person); at most one customer (person or organization), none only for a counter, and then `customer_label` is required; `customer_phone_number` is empty once `customer_person_id` is set.

## Acceptance criteria
```gherkin
Scenario: AC-1 New customer
  When a SELLER pushes a relationship with customer_phone_number "6 77 12 34 56"
  Then a guest person holds +237677123456 and the relationship has customer_person_id set, an empty phone column, limit 0 and balance 0
Scenario: AC-2 Duplicate merged
  Given the organization already has that customer
  When a second phone pushes the same number as a new row
  Then the new row is deleted with merged_into_id set and the batch is not rejected
Scenario: AC-3 Redirect
  When the same batch has an order for the duplicate's id
  Then the order is stored on the surviving relationship
Scenario: AC-4 Invalid number
  When the phone number is not a valid mobile
  Then the line is an issue INVALID_PHONE and nothing is stored, and the rest of the batch passes
Scenario: AC-5 Edit
  When a SELLER updates customer_label and supplier_notes
  Then both are stored
Scenario: AC-6 Repeat
  When the same created row is pushed twice
  Then one relationship exists
```

## Abuse cases
```gherkin
Scenario: AB-1 A duplicate never blocks the batch (denial of service)
  When two phones add the same customer offline
  Then both batches succeed
Scenario: AB-2 Credit chosen by the phone (mass assignment)
  When the pushed row carries credit_limit or status ENDED
  Then the line is forbidden and the relationship is created with defaults or unchanged
```

## Implementation
- Create: `src/modules/sync/adapters/relationship.push.ts`, `tests/integration/sync/push-relationships.test.ts`
- Modify: `src/modules/sync/sync.judge.ts`, `src/modules/sync/sync.types.ts`
- Pattern: `src/modules/sync/adapters/relationship.adapter.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.1: create and update follow the rules table.
- v5.0.0-2.3.3: person, relationship and merge in one transaction.
- v5.0.0-2.4.1: creating persons is bounded by the batch size limit.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| new customer | integration | AC-1, C-06 | person and row |
| duplicate merged | integration | AC-2, C-36 | merged_into_id |
| redirect | integration | AC-3 | order on survivor |
| invalid number | integration | AC-4 | issue, rest passes |
| edit | integration | AC-5 | stored |
| repeat | integration | AC-6 | one row |
| never blocked | security | AB-1, CWE-400 | both succeed |
| credit by phone | security | AB-2, CWE-915 | forbidden |

Command: `npx vitest run tests/integration/sync/push-relationships.test.ts`

## Out of scope
- Orders (SYNC-012).
