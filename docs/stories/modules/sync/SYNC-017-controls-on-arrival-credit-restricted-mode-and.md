---
id: SYNC-017
title: 'Controls on arrival: credit, restricted mode and long absence'
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [SYNC-016, SYNC-014]
read_first: [src/modules/sync/sync.controls.ts, src/modules/delivery/delivery.service.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, synchronisation-hors-ligne/fraicheur-synchronisation-automatique]
constraints: [CM-31, CM-15]
asvs: [v5.0.0-2.3.1, v5.0.0-16.3.3]
---

# SYNC-017 — Controls on arrival: credit, restricted mode and long absence

## Story
As an owner, I want credit overruns and operations made too long after the last sync flagged so that I can call the seller or the customer.

## Context
- Exists: `runControls` (SYNC-016), `creditExceededBy` from viaSync deliveries (SYNC-014), the device's `last_synced_at` before the push.
- Adds to `sync.controls.ts`: `CREDIT_EXCEEDED`: when a delivered order's `creditExceededBy` is above 0, its `sync_issue` gets "<customer_label> : plafond dépassé de <amount>"; `RESTRICTED_MODE`: an operation dated more than 3 days after the device's previous `last_synced_at` gets "opération faite après 3 jours sans synchronisation"; `LONG_ABSENCE`: a push from a device whose previous `last_synced_at` is more than 3 days old adds one information line for the owner: notification `sync.anomalies` "<name> s'est resynchronisé après <n> jours".
- The server never refuses for these; a batch is judged on content only.
- `CM-31`: The server refuses a sync from an app version below the platform minimum; a phone clock more than 5 minutes off makes the app ask for automatic time; operations dated in the future or more than 3 days after the phone's last sync are reported to the owner, never refused.
- `CM-15`: At delivery, the unpaid part must not bring the balance above credit_limit (null limit = no limit); example: limit 50 000, balance 40 000, order 30 000 requires collecting at least 20 000 (design lines 290-299)

## Acceptance criteria
```gherkin
Scenario: AC-1 Credit exceeded
  When a synced delivery exceeds a customer's limit by 15000
  Then the order's sync_issue starts with CREDIT_EXCEEDED naming 15000 and the delivery is recorded
Scenario: AC-2 Restricted mode
  Given the device last synced 6 days ago
  When it pushes a sale dated 5 days after that sync
  Then the sale is stored with RESTRICTED_MODE in sync_issue
Scenario: AC-3 Long absence line
  When a device returns after 6 days
  Then the owner has one information notification "s'est resynchronisé après 6 jours"
Scenario: AC-4 Nothing refused
  Then none of these controls changes the response to anything but 200
Scenario: AC-5 Within limits
  When the delivery is within the limit and the sync is recent
  Then no issue is set
```

## Abuse cases
```gherkin
Scenario: AB-1 Waiting out the restricted mode on a tampered phone (tampering)
  When a tampered phone pushes operations dated late
  Then they are stored and flagged, so the absence is visible to the owner
```

## Implementation
- Create: `tests/integration/sync/controls-credit.test.ts`
- Modify: `src/modules/sync/sync.controls.ts`, `src/modules/sync/adapters/closing.push.ts`, `src/modules/sync/sync.judge.ts`
- Pattern: `src/modules/sync/sync.controls.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.1: the 3-day rule is a check on the server, never a refusal.
- v5.0.0-16.3.3: fixed event names.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| credit exceeded | integration | AC-1, CM-15 | issue with amount |
| restricted mode | integration | AC-2, CM-31 | issue |
| long absence | integration | AC-3 | notification |
| nothing refused | integration | AC-4 | 200 |
| within limits | integration | AC-5 | none |
| tampered phone | security | AB-1, CWE-345 | flagged |

Command: `npx vitest run tests/integration/sync/controls-credit.test.ts`

## Out of scope
- The phone-side restricted mode (client).
