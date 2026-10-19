---
id: BIL-017
title: The owner lists the receipts
module: billing
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [BIL-016, BIL-012]
read_first: [src/modules/billing/billing.owner.routes.ts, src/modules/billing/receipt.repository.ts]
design_refs: [finances/subscriptionreceipt]
constraints: [C-54]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-2.2.1]
---

# BIL-017 — The owner lists the receipts

## Story
As an owner, I want to list my receipts and credit notes so that I can keep them for my accounts.

## Context
- Exists: `receipt.repository.ts` (BIL-012), `billing.owner.routes.ts` and the owner check (BIL-016), `paginationQuerySchema`, `encodeCursor` and `decodeCursor` (`src/shared/pagination.ts`).
- `GET /api/v1/organizations/{organizationId}/billing/receipts?limit&cursor`, OWNER only as in BIL-016 (403, 401, 404). `limit` defaults to 50, at most 100; no other query field; a bad cursor answers 400 `VALIDATION_ERROR`.
- `listReceipts(organizationId, query)` in `receipt.repository.ts` returns the business's rows, `issued_at` newest first, then `id`.
- Answer 200 `{ items, next_cursor }`; an item is `{ number, kind, label, customer_name, customer_tax_id, amount_excl_tax, vat_rate_bp, vat_amount, amount, issued_at }`. A credit note has its own number and the amounts of the receipt it cancels.
- `C-54`: `SubscriptionReceipt`: `number` is unique and has no gap; `amount = amount_excl_tax + vat_amount`; `cancels_receipt_id` is set exactly when `kind = CREDIT_NOTE`, and a receipt has at most one credit note; no update, no delete.

## Acceptance criteria
```gherkin
Scenario: AC-1 The list
  Given 3 receipts and 1 credit note of the business, and 2 receipts of another
  When the owner lists with limit 2, then with the returned cursor
  Then the first page holds the 2 newest, the second the other 2, `next_cursor` is null at the end, and no row of the other business appears
Scenario: AC-2 The fields
  When the owner lists one receipt
  Then the item has exactly the ten fields and no `payment_id`, `organization_id` or `cancels_receipt_id`
Scenario Outline: AC-3 Refused
  When the request has <problem>
  Then the answer is <answer>
  Examples:
    | problem                                         | answer                 |
    | limit 0, limit 101, a bad cursor, another field | 400 `VALIDATION_ERROR` |
    | a manager, a seller or a driver                 | 403 `FORBIDDEN`        |
    | a person outside the business                   | 404 `NOT_FOUND`        |
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's receipts through a cursor or an id (information disclosure)
  When an owner of A uses B's organization id, or a cursor made from a receipt of B
  Then the answer is 404, or a page without any row of B
```

## Implementation
- Create: `tests/integration/billing/receipt-list.test.ts`
- Modify: `src/modules/billing/receipt.repository.ts`, `src/modules/billing/owner-view.service.ts`, `src/modules/billing/billing.owner.routes.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `listReceipts(actor: OrganizationActor, query: PaginationQuery): Promise<{ items: ReceiptView[]; next_cursor: string | null }>`
- Types:
  - `ReceiptView = the ten item fields above, amounts as numbers`
- Errors: `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: owner only.
- v5.0.0-8.2.2: the query is bound to the organization id from `loadActor`; a cursor holds no organization.
- v5.0.0-2.2.1: limit has a maximum and unknown fields are refused.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1, C-54 | pages, order, no other business |
| fields | integration | AC-2 | ten fields |
| refused | integration | AC-3 | each Examples row → answer |
| other business | security | AB-1, CWE-639 | 404 or page without B rows |

Command: `npx vitest run tests/integration/billing/receipt-list.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the receipts path | add GET /api/v1/organizations/{organizationId}/billing/receipts, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the receipts path | add GET /api/v1/organizations/{organizationId}/billing/receipts, remove nothing |

## Out of scope
- Downloading a receipt as a file.
