---
id: NTF-005
title: Notifications about one entity can be pointed at its replacement
module: notification
kind: technical
rev: 1
amends: []
size: XS
risk: low
depends_on: [NTF-001]
read_first: [src/modules/notification/notification.repository.ts, tests/integration/notification/list.test.ts]
design_refs: [a1-modifier-remplacer-une-commande-en/notification-complete-8-1]
constraints: []
asvs: [v5.0.0-8.2.2]
---

# NTF-005 — Notifications about one entity can be pointed at its replacement

## Story
Technical story: point every notification about an entity at the entity that replaced it, so that tapping an old notification opens the current version.

## Context
- A customer may replace a pending order with a new version (ORD-039): the old notifications must open the new one.
- New contract `retargetNotifications(tx, { type, fromId, toId })` in `notification.service.ts`, delegating to one `updateMany` in `notification.repository.ts`.
- It sets `related_entity_id` to `toId` where `related_entity_type` = `type` and `related_entity_id` = `fromId`, for every recipient, read or not; it returns the count.
- The database sets `server_updated_at` on every change, so phones pull the moved notifications (SYNC-007).
- It changes nothing else: recipient, content, read status and dates stay.

## Acceptance criteria
```gherkin
Scenario: AC-1 Moving the notifications of one order
  Given two notifications of type order about order O1, for two recipients, one read
  And one notification of type order about order O2
  When retargetNotifications runs with type order, from O1, to O3
  Then it returns 2, both now name O3 with their recipient, content and read status unchanged
  And the notification about O2 is unchanged
Scenario: AC-2 Another entity type is never moved
  Given a notification of type customer_relationship whose related id equals O1
  When retargetNotifications runs with type order, from O1, to O3
  Then it returns 0 and that notification is unchanged
Scenario: AC-3 Phones see the change
  When a notification is moved
  Then its server_updated_at is later than before
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/notification/retarget.test.ts`
- Modify: `src/modules/notification/notification.service.ts`, `src/modules/notification/notification.repository.ts`
- Pattern: `tests/integration/notification/list.test.ts`
- Signatures:
  - `retargetNotifications(tx: Prisma.TransactionClient, input: { type: string; fromId: string; toId: string }): Promise<number>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: only the related entity changes; each notification keeps its recipient, so nobody gains a notification.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| move | integration | AC-1 | two moved with recipient, content and read status kept; the O2 one unchanged |
| other type | integration | AC-2 | count 0, notification unchanged |
| pulled again | integration | AC-3 | server_updated_at later than before |

Command: `npx vitest run tests/integration/notification/retarget.test.ts`

## Out of scope
- Calling it when an order is replaced (ORD-039).
