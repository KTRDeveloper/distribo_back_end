---
id: SYNC-015
title: Push payments and notification reads
module: sync
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [SYNC-014, FIN-004, NTF-004]
read_first: [src/modules/finance/ledger.service.ts, src/modules/sync/sync.judge.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, finances/ledgerentry]
constraints: [CM-27, C-36]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-2.3.4]
---

# SYNC-015 — Push payments and notification reads

## Story
As a seller, I want payments I collected offline to reach the customer's account so that balances stay right.

## Context
- Exists: `appendLedgerEntry` (FIN-003), rules for ledger kinds (ACC-004), judge pipeline.
- Adds: `adapters/ledger.push.ts` registering `ledger_entries` and `notifications` push sides.
- Ledger create: a PAYMENT with `id`, `customer_relationship_id` (redirected if merged), `amount`, `mode`, `transaction_reference`, `note`, `occurred_at`, `order_id` empty (payments tied to a delivery are handled by SYNC-014), by SELLER and above; the server sets `recorded_by_id` the viewer and appends it through `appendLedgerEntry` (balance down, viewer's held money up). `balance_effect` is ignored. Any other kind (REFUND, CREDIT_NOTE, OPENING_BALANCE, a reversal) and any update or delete of a ledger row is `forbidden` (`ONLINE_ONLY`). A PENDING relationship or a missing one is an issue that is not stored.
- Notifications: an update of `read_status` on the viewer's own notification is accepted; any other field or another person's notification is forbidden.
- A payment id already stored is accepted without a second write.
- `CM-27`: Sync: computed fields (balance, amount_held, balance_effect, totals, line amounts, sale amount, customer-order reference price, price_updated_at, credit_limit_set_at, ended_by_party, last_synced_at, scope_version, server_updated_at) are ignored on receipt and recomputed.
- `C-36`: No uniqueness rule makes a sync fail; every possible duplicate has a written behavior, and a line no rule can write is set aside.

## Acceptance criteria
```gherkin
Scenario: AC-1 Payment
  When a SELLER pushes a cash PAYMENT of 20000 for a customer with balance 45000
  Then the balance is 25000 and the seller's amount_held is +20000
Scenario Outline: AC-2 Forbidden kinds
  When a phone pushes <row>
  Then the line is forbidden with ONLINE_ONLY and nothing is stored
  Examples:
    | row                                   |
    | a REFUND                              |
    | a CREDIT_NOTE                         |
    | an OPENING_BALANCE                    |
    | an update of an existing entry        |
    | a delete of an entry                  |
Scenario: AC-3 Repeat
  When the same payment is pushed twice
  Then one entry exists and the caches change once
Scenario: AC-4 Notification read
  When the viewer pushes read_status READ on their notification
  Then it is READ; another person's notification or another field is forbidden
Scenario: AC-5 Merged customer
  When the payment names a merged duplicate relationship
  Then it is stored on the surviving one
```

## Abuse cases
```gherkin
Scenario: AB-1 A phone credits itself money it did not collect (tampering)
  When a SELLER pushes a REFUND or a negative balance_effect
  Then the line is forbidden and no entry exists
Scenario: AB-2 Payment on another business's customer (horizontal)
  Then the line is forbidden OUT_OF_SCOPE
```

## Implementation
- Create: `src/modules/sync/adapters/ledger.push.ts`, `tests/integration/sync/push-payments.test.ts`
- Modify: `src/modules/sync/sync.judge.ts`
- Pattern: `src/modules/sync/adapters/order.push.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.1: only the SELLER payment kind is writable by sync.
- v5.0.0-2.3.4: caches change by addition through `appendLedgerEntry`.
- v5.0.0-2.3.3: entry and caches are one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| payment | integration | AC-1, CM-27 | balance and held |
| forbidden kinds | integration | AC-2 | each Examples row → ONLINE_ONLY |
| repeat | integration | AC-3, C-36 | once |
| notification read | integration | AC-4 | as described |
| merged | integration | AC-5 | survivor |
| self-credit | security | AB-1, CWE-345 | forbidden |
| other business | security | AB-2, WSTG-ATHZ-04 | forbidden |

Command: `npx vitest run tests/integration/sync/push-payments.test.ts`

## Out of scope
- Every other table: online only.
