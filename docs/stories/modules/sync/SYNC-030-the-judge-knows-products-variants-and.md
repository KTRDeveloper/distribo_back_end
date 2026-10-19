---
id: SYNC-030
title: The judge knows products, variants and negotiated prices
module: sync
kind: change
rev: 1
amends: [SYNC-010]
size: M
risk: high
depends_on: [SYNC-010, SYNC-024, SYNC-027, ACC-008, CAT-023, CAT-024, CAT-026]
read_first: [src/modules/sync/sync.judge.ts, src/modules/sync/sync.repository.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, catalogue/product]
constraints: [CM-27]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# SYNC-030 — The judge knows products, variants and negotiated prices

## Story
As an owner, I want the catalog and the prices I edit offline to be judged by the same rules as every other line, so that no one but me can change them from a phone.

## Context
- Exists: `JUDGE_TABLE_ORDER` (six tables), `RULES_OF`, `findStoredRow`, `stripComputed`, the verdicts `OUT_OF_SCOPE` and `FIELD_NOT_ALLOWED` (SYNC-010); the rule rows for Product, ProductVariant and CustomerPrice, open offline to the OWNER and, online only, to a MANAGER (ACC-008, CAT-023, CAT-024, CAT-026).
- `JUDGE_TABLE_ORDER` becomes customer_relationships, products, product_variants, customer_prices, orders, order_lines, deliveries, ledger_entries, notifications: a price may name a variant of the same batch. `JudgedTable` gains the three tables.
- Scope: a product belongs to its `organization_id`; a variant to its product's organization (new `findProductOwner` in `sync.repository.ts`; a stored variant by its own `organization_id`); a price to the supplier of its relationship. Only an ACTIVE member of that organization is in scope; any other id answers `OUT_OF_SCOPE`, known or not.
- Rights: create needs `create` on the subject, each changed field `update`, a deletion `delete`. A MANAGER, SELLER or DRIVER therefore gets `FIELD_NOT_ALLOWED`; the OWNER passes.
- Computed, removed before the adapter: Product `paused_at`, `image_keys`, `image_urls`; ProductVariant `merged_into_id`, `image_keys`, `image_urls` (`price_updated_at` is already removed); CustomerPrice `set_at`, `set_by_id`. On a create, `set_by_id` is then the viewer's id.
- The row handed to the adapter carries `organization_id` set to the organization of the scope, whatever the phone sent, so that no adapter takes it from the phone.
- `CM-27`: Sync: computed fields (balance, amount_held, balance_effect, totals, line amounts, sale amount, customer-order reference price, price_updated_at, credit_limit_set_at, ended_by_party, last_synced_at, scope_version, server_updated_at) are ignored on receipt and recomputed (design lines 862, annex A.1)

## Acceptance criteria
```gherkin
Scenario: AC-1 The owner passes
  When the OWNER pushes a new product, a new variant of it and a new price
  Then each line reaches its adapter, tables in the order products, product_variants, customer_prices, then orders
Scenario: AC-2 Others are refused
  When a MANAGER, a SELLER or a DRIVER of the business pushes a product creation, a variant update or a price deletion
  Then each line is forbidden `FIELD_NOT_ALLOWED` and no adapter sees it
Scenario: AC-3 Computed fields
  When the OWNER pushes rows carrying the computed fields above
  Then the adapter receives none of them
  And a created price carries the OWNER's id as `set_by_id`
  And a variant row carries its product's organization as `organization_id`, whatever the phone sent
Scenario: AC-4 Scope
  When a line names a product, a variant, a price or a relationship of another business, or an unknown id
  Then it is forbidden `OUT_OF_SCOPE`, with the same answer for both
Scenario: AC-5 A field outside the catalog list
  When the OWNER updates a variant's `product_id` or a product's `organization_id`
  Then that line is forbidden `FIELD_NOT_ALLOWED`
```

## Abuse cases
```gherkin
Scenario: AB-1 A seller or driver edits the catalog by sync (privilege, T9)
  When a SELLER pushes a new product, or a DRIVER pushes a price change, with the right ids
  Then the lines are forbidden, nothing is stored, and the usual refusal record and resync follow (SYNC-018)
Scenario: AB-2 A forged author on a price (spoofing)
  When the OWNER pushes a price with `set_by_id` of another person
  Then the stored author is the OWNER
```

## Implementation
- Create: `tests/integration/sync/judge-catalog.test.ts`
- Modify: `src/modules/sync/sync.judge.ts`, `src/modules/sync/sync.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `findProductOwner(tx: Prisma.TransactionClient, id: string): Promise<RowOwner | null>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.1: the owner of a new row comes from its parent, never from an organization id the phone adds.
- v5.0.0-8.2.2: the three tables are read by id inside the push transaction, scoped to the viewer's ACTIVE memberships.
- v5.0.0-15.3.3: server-written fields and the author are removed or overwritten before any adapter.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| owner passes | integration | AC-1 | three adapters spied, order |
| others refused | integration | AC-2 | three roles, three kinds of line |
| computed removed | integration | AC-3, CM-27 | adapter input, author |
| scope | integration | AC-4 | foreign and unknown ids |
| closed field list | integration | AC-5 | product_id, organization_id |
| seller catalog | security | AB-1, CWE-269 | forbidden, nothing stored |
| forged author | security | AB-2, CWE-290 | OWNER stored |

Command: `npx vitest run tests/integration/sync/judge-catalog.test.ts tests/integration/sync/judge.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/judge.test.ts | the order test expects the six table names | it expects the nine names in the order above |

## Out of scope
- Writing the rows (the adapters still refuse): SYNC-031 to SYNC-034.
- A variant whose product the batch set aside is out of scope, like any unknown product.
