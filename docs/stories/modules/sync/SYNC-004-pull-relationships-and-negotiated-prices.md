---
id: SYNC-004
title: Pull relationships and negotiated prices
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-003, REL-005, CAT-002]
read_first: [src/modules/sync/adapters/identity.adapter.ts, src/modules/relationship/relationship.visibility.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, relations-commerciales/customerrelationship/cloisonnement]
constraints: [CM-30, C-35]
asvs: [v5.0.0-8.2.2, v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# SYNC-004 — Pull relationships and negotiated prices

## Story
As a driver, I want my phone to know each customer's available credit, and nothing more, so that I can check credit offline without seeing debts.

## Context
- Exists: pull engine (SYNC-003); `visibleRelationsWhere`, `projectForSupplier`, `projectForCustomer`, `projectForDriver` (REL-005).
- Adds: `adapters/relationship.adapter.ts` registering `customer_relationships` and `customer_prices`.
- Relationships for an organization viewer: the organization's rows as supplier (all customers and counters) in the supplier projection for SELLER and above; for a DRIVER only rows that have a CONFIRMED order with an address or a delivery of theirs, sent with `credit_limit` = the available credit (limit minus balance, null when there is no ceiling), `balance` = 0 and no notes or labels except `customer_label`. The customer person's own rows use the customer projection. Deleted and merged rows go to `deleted`.
- `customer_prices`: rows for the organization's customers to OWNER, MANAGER and SELLER; a customer person receives only their own relationships' rows; a DRIVER receives none.
- `CM-30`: Sync pull returns only what the user may see; a driver receives, per customer, only the available credit instead of balance and limit; the phone keeps all customers, the catalog, open orders and the last 90 days of the rest.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Seller receives customers
  When a SELLER pulls
  Then all the organization's customers and counters arrive with customer_label, supplier_notes, credit_limit and balance
Scenario: AC-2 Driver receives available credit only
  Given a customer with limit 50000 and balance 40000 and a confirmed order to deliver
  When a DRIVER pulls
  Then that relationship has credit_limit 10000 and balance 0, and no supplier_notes
Scenario: AC-3 No ceiling
  When the limit is empty
  Then the driver's credit_limit is null
Scenario: AC-4 Customer person
  When a customer person pulls
  Then their relationships arrive in the customer view (supplier_label, no customer_label)
Scenario: AC-5 Merged and deleted
  Then a merged duplicate is listed in `deleted`
```

## Abuse cases
```gherkin
Scenario: AB-1 A driver's phone learns debts (information disclosure)
  When the driver's pull is searched for balance, credit_limit or notes of any customer
  Then only available credit in the credit_limit column appears
```

## Implementation
- Create: `src/modules/sync/adapters/relationship.adapter.ts`, `tests/integration/sync/pull-relationships.test.ts`
- Modify: `src/modules/sync/sync.service.ts`
- Pattern: `src/modules/sync/adapters/identity.adapter.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.3: the driver projection replaces balance and limit.
- v5.0.0-8.2.2: rows come from the visibility predicate.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| seller | integration | AC-1, C-35 | supplier view |
| driver | integration | AC-2, CM-30 | 10000 and 0 |
| no ceiling | integration | AC-3 | null |
| customer person | integration | AC-4 | customer view |
| merged | integration | AC-5 | in deleted |
| driver debts | security | AB-1, CWE-200 | none |

Command: `npx vitest run tests/integration/sync/pull-relationships.test.ts`

## Out of scope
- Orders and deliveries (SYNC-006).
