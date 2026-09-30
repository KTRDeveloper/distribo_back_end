---
id: NTF-002
title: Notify service
module: notification
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [NTF-001, FND-006]
read_first: [docs/stories/modules/foundation/contracts.md, src/modules/tasks/tasks.repository.ts]
design_refs: [notifications/notification]
constraints: ['Notification:required', C-30]
asvs: [v5.0.0-16.2.5, v5.0.0-2.2.1]
---

# NTF-002 — Notify service

## Story
Technical story: provide `notify` and `recipientLanguage` so every module stores notifications the same way.

## Context
- Exists: `notifications` (NTF-001); `newId`; `httpError`.
- Adds: `src/modules/notification/notification.repository.ts` and `notification.service.ts`.
- `NotifyInput = { recipientId, organizationId?, sourceEvent, content, related?: { type, id } }`. `sourceEvent` is one of the design's event names, for example `order.placed` or `customer.added`.
- Content is written by the caller in the recipient's language (`recipientLanguage`, Q-028). A notification never contains a password, code or token.
- `Notification:required`: NOT NULL: `recipient_id`, `content`, `source_event`, `read_status`, `created_at`
- `C-30`: `Notification` recipient is a registered person; `related_entity_type` and `related_entity_id` are both set or both empty.

## Acceptance criteria
```gherkin
Scenario: AC-1 Store a notification
  When notify is called with a registered recipient, sourceEvent "order.placed" and content "Nouvelle commande"
  Then one UNREAD row exists with that content and source_event
Scenario: AC-2 Inside a caller's transaction
  When notify runs with a transaction that later rolls back
  Then no notification exists
Scenario Outline: AC-3 Invalid input
  When notify receives <input>
  Then it throws `httpError(400, 'VALIDATION_ERROR', ...)`
  Examples:
    | input                                  |
    | empty sourceEvent                      |
    | empty content                          |
    | related with a type but no id          |
    | a guest recipient                      |
Scenario: AC-4 Language
  Then recipientLanguage returns the person's preferred language, or FR when it is empty
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/modules/notification/notification.repository.ts`, `src/modules/notification/notification.service.ts`, `tests/integration/notification/notify.test.ts`
- Pattern: `src/modules/tasks/tasks.repository.ts`
- Signatures:
  - `notify(input: NotifyInput, tx?: Prisma.TransactionClient): Promise<void>`
  - `recipientLanguage(personId: string): Promise<'FR' | 'EN'>`
- Types:
  - `NotifyInput = { recipientId: string; organizationId?: string; sourceEvent: string; content: string; related?: { type: string; id: string } }`
- Errors: `VALIDATION_ERROR` 400
- Dependencies: `@prisma/client`, `zod`

## Security
- v5.0.0-16.2.5: the service never logs `content`; it logs the recipient id and `sourceEvent` only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| store | integration | AC-1, Notification:required | notify → one UNREAD row |
| transaction | integration | AC-2 | rollback → zero rows |
| invalid input | integration | AC-3, C-30 | each Examples row → 400 error, no row |
| language | integration | AC-4 | EN person → EN; empty → FR |

Command: `npx vitest run tests/integration/notification/notify.test.ts`

## Out of scope
- Sending push notifications (Q-007).
