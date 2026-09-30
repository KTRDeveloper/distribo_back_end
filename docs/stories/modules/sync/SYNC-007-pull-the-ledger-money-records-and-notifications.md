---
id: SYNC-007
title: Pull the ledger, money records and notifications
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-006, FIN-001, FIN-014, REL-003, NTF-001, FIN-003]
read_first: [src/modules/sync/adapters/order.adapter.ts, src/modules/finance/ledger.service.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, finances/handover]
constraints: [CM-30, C-35]
asvs: [v5.0.0-8.2.2, v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# SYNC-007 — Pull the ledger, money records and notifications

## Story
As a manager, I want my phone to hold the recent ledger, expenses, handovers and notifications so that I can consult them offline.

## Context
- Exists: pull engine and adapters (SYNC-003 to SYNC-006); ledger, expenses, handovers, credit limit journal, notifications.
- Adds: `adapters/money.adapter.ts` registering `ledger_entries`, `expenses`, `handovers`, `credit_limit_changes` and `notifications`. Retention on the phone: the last 90 days by `occurred_at`, `cancelled_at`, `set_at` or `created_at`, except notifications (all unread and the last 90 days).
- Scope: `ledger_entries` for OWNER, MANAGER and SELLER: entries of the organization's relationships (with `recorded_by_id` for OWNER and MANAGER only); a DRIVER receives none; a customer person receives entries of their relationships without `recorded_by_id` and `transaction_reference`. `expenses`, `handovers` and `credit_limit_changes`: OWNER and MANAGER all rows of the organization; SELLER and DRIVER only handovers where they are `from_person_id` or `to_person_id`. `notifications`: the viewer's own rows (`recipient_id`), never others'.
- `CM-30`: Sync pull returns only what the user may see; a driver receives, per customer, only the available credit instead of balance and limit; the phone keeps all customers, the catalog, open orders and the last 90 days of the rest.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Seller ledger
  Given ledger entries, 40 days old and 120 days old
  When a SELLER pulls
  Then the 40-day-old entries arrive and the 120-day-old ones do not
Scenario: AC-2 Driver gets no ledger
  Then a DRIVER receives no ledger_entries, expenses or credit_limit_changes, and only handovers involving them
Scenario: AC-3 Customer person
  Then their ledger entries arrive without recorded_by_id
Scenario: AC-4 Notifications
  Then each viewer receives only their own notifications
Scenario: AC-5 Money records for managers
  Then an OWNER and a MANAGER receive all expenses and handovers of the organization
```

## Abuse cases
```gherkin
Scenario: AB-1 Other people's notifications and other businesses' money (horizontal)
  When a member of A pulls
  Then no ledger entry, expense, handover or notification of B or of another person appears
```

## Implementation
- Create: `src/modules/sync/adapters/money.adapter.ts`, `tests/integration/sync/pull-money.test.ts`
- Modify: `src/modules/sync/sync.service.ts`
- Pattern: `src/modules/sync/adapters/order.adapter.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: scope from memberships and the person id.
- v5.0.0-8.2.3: recorder and reference fields by role.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| seller ledger | integration | AC-1, CM-30 | recent only |
| driver | integration | AC-2 | none but own handovers |
| customer | integration | AC-3, C-35 | no author |
| notifications | integration | AC-4 | own only |
| managers | integration | AC-5 | all rows |
| other scopes | security | AB-1, WSTG-ATHZ-04 | none |

Command: `npx vitest run tests/integration/sync/pull-money.test.ts`

## Out of scope
- Writing any of these tables (SYNC-015, SYNC-016).
