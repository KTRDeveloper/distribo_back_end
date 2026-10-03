---
id: NTF-002
title: Notify service
module: notification
kind: technical
rev: 2
amends: []
size: S
risk: medium
depends_on: [NTF-001, FND-006]
read_first: [docs/stories/modules/foundation/contracts.md, src/modules/tasks/tasks.repository.ts, src/shared/limits.ts]
design_refs: [notifications/notification]
constraints: ['Notification:required', C-30]
asvs: [v5.0.0-16.2.5, v5.0.0-2.2.1]
---

# NTF-002 — Notify service

## Story
Technical story: provide `notify` and `recipientLanguage` so every module stores notifications the same way.

## Context
- Exists: `notifications` (NTF-001); `newId`; `uuidV7Schema`; `httpError`; `TEXT_MAX = 2000`; `LABEL_MAX = 100`.
- Adds: `src/modules/notification/notification.repository.ts` and `notification.service.ts`.
- `NotifyInput = { recipientId, organizationId?, sourceEvent, content, related?: { type, id } }`.
- A person is registered if and only if their row exists and `registered_at IS NOT NULL`. A row with `registered_at IS NULL` is a guest. Registration is not derived from status, password, phone verification or profile completeness.
- A missing recipient and a guest recipient are both invalid and answer 400 `VALIDATION_ERROR` without revealing which case occurred.
- `sourceEvent` is an exact, untrimmed, lowercase dotted snake-case name of at most `LABEL_MAX` characters. It has at least two nonempty segments and matches `^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$`. The names in the design, such as `order.placed` and `customer.added`, are examples rather than a closed allowlist; later modules may add names that follow this grammar.
- Content is written by the caller in the recipient's language (`recipientLanguage`, Q-028). A notification never contains a password, code or token.
- `content` is nonblank and at most `TEXT_MAX` characters. Blank validation ignores surrounding whitespace, but valid content is stored verbatim rather than trimmed.
- `related.type`, when present, is nonblank and at most `LABEL_MAX` characters; `related.id` is a UUIDv7. `related` contains both fields or is absent.
- `recipientId`, `organizationId` when present, and `related.id` when present are canonical UUIDv7 values validated with `uuidV7Schema`.
- `Notification:required`: NOT NULL: `recipient_id`, `content`, `source_event`, `read_status`, `created_at`.
- `C-30`: `Notification` recipient is a registered person; `related_entity_type` and `related_entity_id` are both set or both empty.
- Input length, blank-string and source-event shape rules are enforced both by Zod and by new validated database `CHECK` constraints. The migration validates existing rows; it does not add unvalidated constraints.

## Acceptance criteria
```gherkin
Scenario: AC-1 Store a notification
  When notify is called with a registered recipient, sourceEvent "order.placed" and content "Nouvelle commande"
  Then one UNREAD row exists with that content and source_event
Scenario: AC-2 Inside a caller's transaction
  When notify runs with a transaction that later rolls back
  Then no notification exists
  And the recipient lookup and insert both used that transaction
Scenario Outline: AC-3 Invalid input
  When notify receives <input>
  Then it throws `httpError(400, 'VALIDATION_ERROR', ...)`
  And no notification exists
  Examples:
    | input                                             |
    | empty or whitespace-only sourceEvent              |
    | sourceEvent with uppercase, padding or bad syntax |
    | sourceEvent longer than LABEL_MAX                 |
    | empty or whitespace-only content                  |
    | content longer than TEXT_MAX                      |
    | related with a type but no id                     |
    | related with an id but no type                    |
    | empty or overlong related type                    |
    | malformed or non-v7 identifier                    |
    | an unknown recipient                              |
    | a guest recipient                                 |
Scenario: AC-4 Language
  Then recipientLanguage returns the registered person's preferred language, or FR when it is empty
  And it rejects a missing or guest person with 400 `VALIDATION_ERROR`
Scenario: AC-5 Extensible event namespace
  When notify receives a valid planned event outside the design examples, such as "delivery.assigned"
  Then the notification is stored
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/modules/notification/notification.repository.ts`, `src/modules/notification/notification.service.ts`, `tests/integration/notification/notify.test.ts`, `prisma/migrations/<timestamp>_ntf_002_notify_validation/migration.sql`.
- Update: `docs/stories/modules/notification/model.md` with the new database and validation constraints.
- Pattern: `src/modules/tasks/tasks.repository.ts`.
- Use `const client = tx ?? prisma` for the registered-recipient lookup and insert. Explicitly reject a missing row or `registeredAt === null` before inserting; retain the NTF-001 database guard as defense in depth.
- Derive the source-event Zod rule from `LABEL_MAX` and the canonical namespaced pattern; do not create a closed event enum in this generic service.
- The migration adds checks for nonblank content, `char_length(content) <= 2000`, canonical bounded `source_event`, and nonblank `related_entity_type` of at most 100 characters when present. Do not edit the merged NTF-001 migration.
- Signatures:
  - `notify(input: NotifyInput, tx?: Prisma.TransactionClient): Promise<void>`
  - `recipientLanguage(personId: string, tx?: Prisma.TransactionClient): Promise<'FR' | 'EN'>`
- Types:
  - `NotifyInput = { recipientId: string; organizationId?: string; sourceEvent: string; content: string; related?: { type: string; id: string } }`
- `recipientLanguage` validates `personId`, reads through `tx ?? prisma`, returns `FR` or `EN`, defaults a null preference to `FR`, and rejects missing or guest people with the same safe validation error.
- Errors: `VALIDATION_ERROR` 400.
- Dependencies: `@prisma/client`, `zod`.

## Security
- v5.0.0-16.2.5: the service never logs `content`; it logs the recipient id and `sourceEvent` only.
- v5.0.0-2.2.1: all strings and identifiers have explicit format and size bounds at the service boundary, with the applicable text constraints repeated in the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| store | integration | AC-1, Notification:required | notify → one UNREAD row with content preserved verbatim |
| transaction | integration | AC-2 | rollback → zero rows; transaction-local recipient is visible |
| invalid input | integration | AC-3, C-30 | each Examples row → 400 error, no row |
| boundaries | integration | AC-3, v5.0.0-2.2.1 | 2000/2001 content and 100/101 label characters → accept/reject |
| source event | integration | AC-3, AC-5 | documented and future valid names accepted; malformed names rejected |
| language | integration | AC-4 | FR, EN and empty preference → FR/EN/FR; missing and guest → 400 |
| database checks | integration | C-30, v5.0.0-2.2.1 | direct invalid inserts → check violation |

### Tests to update
- `tests/integration/notification/notification-table.test.ts`: replace arbitrary uppercase `source_event` fixtures with canonical namespaced values because the NTF-002 migration enforces the source-event grammar. Do not weaken its NTF-001 table, pair or registered-recipient assertions.

Command: `npx vitest run tests/integration/notification/notify.test.ts tests/integration/notification/notification-table.test.ts`

## Out of scope
- Sending push notifications (Q-007).
- A closed global registry of source-event names. If later required, inventory and reconcile all downstream notification names, including notifications whose stories do not yet assign a name, in a separate story.
