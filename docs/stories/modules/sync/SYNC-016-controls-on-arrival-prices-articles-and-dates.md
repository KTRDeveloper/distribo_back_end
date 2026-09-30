---
id: SYNC-016
title: 'Controls on arrival: prices, articles and dates'
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [SYNC-012, NTF-002]
read_first: [src/modules/sync/adapters/order.push.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, annexe-la-table-des-regles/controles-a-l-arrivee]
constraints: [CM-31, CM-28]
asvs: [v5.0.0-2.3.1, v5.0.0-16.3.3]
---

# SYNC-016 — Controls on arrival: prices, articles and dates

## Story
As an owner, I want sales at an old price, retired articles and odd dates flagged rather than refused so that I review exceptions only.

## Context
- Exists: order push (SYNC-012) with the retired-article issue; `getReferencePrice` (CAT-003); orders' `sync_issue` text.
- Adds: `src/modules/sync/sync.controls.ts` (`runControls`), called after an order is stored. Controls never refuse; each sets the order's `sync_issue` (joined by " ; " when several) with a code prefix `CODE: message`.
- `PRICE_CHANGED`: a line's `reference_price` differs from the current reference price and the change date (`changedAt`) is later than the order's `created_at`: "vendu 3 000 ; prix passé à 3 200 lundi à 8 h". Such a line is not a price gap by the seller: `price_set_by_id` and `price_set_at` are cleared when the applied price equals the phone's reference price.
- `DATE_IN_FUTURE`: `created_at` later than the server now plus 5 minutes. `DATE_OUT_OF_ORDER`: `created_at` earlier than the device's previous `last_synced_at` minus 92 days.
- After a batch with any issue, each OWNER of the organization gets one notification `sync.anomalies` ("<n> écarts à vérifier").
- `CM-31`: The server refuses a sync from an app version below the platform minimum; a phone clock more than 5 minutes off makes the app ask for automatic time; operations dated in the future or more than 3 days after the phone's last sync are reported to the owner, never refused.
- `CM-28`: Sync outcomes: a business problem is stored with sync_issue; a conflict is refused until the phone pulls and resends; a forbidden send is refused, recorded, and triggers a full resync plus a notification to its author; a line no rule can write is set aside while the rest passes.

## Acceptance criteria
```gherkin
Scenario: AC-1 Sold at the old price
  Given the price rose from 3000 to 3200 on Monday 8h and a seller sold at 3000 on Sunday offline
  When the order arrives on Monday afternoon
  Then the order is stored, its sync_issue starts with PRICE_CHANGED, and no price gap author is set
Scenario: AC-2 A real discount
  When the applied price is below the phone's own reference price
  Then it stays a price gap with its author and no PRICE_CHANGED issue
Scenario: AC-3 Dates
  When created_at is 2 hours ahead of the server
  Then the issue DATE_IN_FUTURE is set and the order is stored
Scenario: AC-4 Owner told once per batch
  When a batch produces 3 issues
  Then each owner has one unread `sync.anomalies` mentioning 3
Scenario: AC-5 Clean batch
  Then no issue and no notification result
```

## Abuse cases
```gherkin
Scenario: AB-1 Hiding a discount behind an old date (tampering)
  When a phone claims an old reference price that never existed
  Then the reference is compared with the price history the server has and the discount stays visible
```

## Implementation
- Create: `src/modules/sync/sync.controls.ts`, `tests/integration/sync/controls-prices.test.ts`
- Modify: `src/modules/sync/adapters/order.push.ts`, `src/modules/sync/sync.judge.ts`
- Pattern: `src/modules/sync/adapters/order.push.ts`
- Signatures:
  - `runControls(tx: Prisma.TransactionClient, ctx: PushContext, order: Order): Promise<string[]>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.1: controls run on the server against current data.
- v5.0.0-16.3.3: anomalies produce a notification with a fixed event name.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| old price | integration | AC-1, CM-28 | PRICE_CHANGED |
| real discount | integration | AC-2 | gap kept |
| dates | integration | AC-3, CM-31 | issue, stored |
| owner told | integration | AC-4 | one notification |
| clean | integration | AC-5 | none |
| hidden discount | security | AB-1, CWE-345 | visible |

Command: `npx vitest run tests/integration/sync/controls-prices.test.ts`

## Out of scope
- Credit and restricted-mode controls (SYNC-017).
