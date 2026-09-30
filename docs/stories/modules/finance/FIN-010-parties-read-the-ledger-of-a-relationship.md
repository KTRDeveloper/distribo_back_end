---
id: FIN-010
title: Parties read the ledger of a relationship
module: finance
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [FIN-009, FND-009]
read_first: [src/modules/finance/finance.routes.ts, src/modules/relationship/relationship.visibility.ts]
design_refs: [finances/ledgerentry]
constraints: [C-23]
asvs: [v5.0.0-8.2.2, v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# FIN-010 — Parties read the ledger of a relationship

## Story
As a customer, I want to read the list of entries on my account so that I see what I owe and why.

## Context
- Exists: ledger entries (FIN-001 to FIN-009); `visibleRelationsWhere`.
- Adds: `GET /api/v1/organizations/{organizationId}/customers/{relationshipId}/ledger` (SELLER and above), `GET /api/v1/suppliers/{relationshipId}/ledger` (the customer person) and `GET /api/v1/organizations/{organizationId}/suppliers/{relationshipId}/ledger` (MANAGER and above for an organization customer); all paginated (`limit`, `cursor`), newest `occurred_at` first, with the current `balance`.
- Item: `id, kind, amount, balance_effect, mode, order_id, reverses_entry_id, note, occurred_at`; the supplier view adds `recorded_by_id` for OWNER and MANAGER only. The customer sees every entry, never `transaction_reference`.
- Adds `finance.openapi.ts` documenting these routes and the finance routes of FIN-004 to FIN-009; `finance.routes.ts` imports it for its side effect.
- `C-23`: `LedgerEntry.amount` > 0; `balance_effect` is a generated column of `kind`, `amount` and `reverses_entry_id`; `mode` is set if and only if `kind` is PAYMENT or REFUND.

## Acceptance criteria
```gherkin
Scenario: AC-1 Supplier reads
  Given a sale of 30000 and a payment of 20000
  When a SELLER reads the ledger
  Then two items are returned newest first with balance 10000
Scenario: AC-2 Customer reads
  When the customer person reads their account
  Then the same two items appear without recorded_by_id
Scenario: AC-3 Pagination
  When limit 1 is used with the cursor
  Then pages of one item follow without repeats
Scenario Outline: AC-4 Roles
  When the caller is <caller>
  Then the response is <status>
  Examples:
    | caller                                | status |
    | a DRIVER of the supplier              | 403    |
    | another person as customer            | 404    |
    | a member of another business          | 404    |
```

## Abuse cases
```gherkin
Scenario: AB-1 Another account's ledger (horizontal)
  When a person or business that is not a party requests the ledger
  Then the response is 404 and no entry is returned
Scenario: AB-2 Team data in the customer view (information disclosure)
  When the customer reads the ledger
  Then no recorded_by_id and no transaction_reference appears
```

## Implementation
- Create: `src/modules/finance/finance.openapi.ts`, `tests/integration/finance/ledger-read.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.service.ts`, `src/modules/finance/finance.schemas.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `listLedger(viewer: LedgerViewer, relationshipId: string, query: { limit: number; cursor?: string }): Promise<{ balance: number; items: LedgerEntryView[]; next_cursor: string | null }>`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.2: the relationship is loaded through the visibility predicate for the viewer's party.
- v5.0.0-8.2.3: per-party field lists.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| supplier reads | integration | AC-1, C-23 | two items, balance |
| customer reads | integration | AC-2 | no author |
| paging | integration | AC-3 | no repeats |
| roles | integration | AC-4 | each Examples row → status |
| not a party | security | AB-1, WSTG-ATHZ-04 | 404 |
| team data | security | AB-2, CWE-200 | absent |

Command: `npx vitest run tests/integration/finance/ledger-read.test.ts`

## Out of scope
- Receipts: generated on the phone.
