---
id: NTF-001
title: Notifications table
module: notification
kind: technical
rev: 1
amends: []
size: XS
risk: low
depends_on: [PER-008, FND-005]
read_first: [prisma/schema.prisma, tests/integration/person/registered-guard.test.ts]
design_refs: [notifications/notification, contraintes-a-poser-au-niveau-base-de]
constraints: ['Notification:required', 'Notification.read_status:enum', C-30, C-01, C-35]
asvs: [v5.0.0-2.2.3]
---

# NTF-001 — Notifications table

## Story
Technical story: create the notifications table with its constraints so that later modules can store events for people.

## Context
- Exists: `people` (PER-002), `require_registered_person()` (PER-008), `set_server_updated_at()` (FND-002).
- Adds: table `notifications` with `server_updated_at` and `deleted_at`; `organization_id` is a plain `uuid` column for now (the foreign key is added when organizations exist, ORG-002); `related_entity_id` is a polymorphic id with no foreign key.
- Triggers: `require_registered_person('recipient_id')`; `set_server_updated_at()`.
- Indexes: `(recipient_id, read_status, created_at desc)`.
- `Notification` fields: `recipient_id` FK → Person; `organization_id` FK → Organization, nullable; `content` text; `source_event` string; `related_entity_type` string, nullable; `related_entity_id` FK, nullable, polymorphe; `read_status` enum [UNREAD / READ]; `pushed_at` datetime, nullable; `created_at` datetime
- `Notification:required`: NOT NULL: `recipient_id`, `content`, `source_event`, `read_status`, `created_at`
- `Notification.read_status:enum`: one of UNREAD, READ
- `C-30`: `Notification` recipient is a registered person; `related_entity_type` and `related_entity_id` are both set or both empty.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Row stored with defaults
  When a notification is inserted for a registered person with content and source_event
  Then `read_status` is UNREAD, `created_at` and `server_updated_at` are set, `pushed_at` is empty
Scenario: AC-2 Guest recipient refused
  When the recipient is a guest
  Then the insert fails with 23514
Scenario Outline: AC-3 Related entity pair
  When a row has related_entity_type <type> and related_entity_id <id>
  Then the insert <result>
  Examples:
    | type    | id             | result  |
    | Order   | a UUID         | accepts |
    | empty   | empty          | accepts |
    | Order   | empty          | rejects |
    | empty   | a UUID         | rejects |
Scenario: AC-4 Enum and foreign key
  When read_status is "SEEN" or recipient_id is unknown
  Then the insert fails
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `prisma/migrations/<timestamp>_ntf_001_notifications/migration.sql`, `tests/integration/notification/notification-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/person/person-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the pair rule and the registered-recipient rule are enforced by the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| defaults | integration | AC-1, Notification:required, C-35, C-01 | insert → UNREAD, timestamps set; column types via expectColumnType |
| guest recipient | integration | AC-2, C-30 | guest → 23514 |
| pair rule | integration | AC-3, C-30 | each Examples row → accepted or 23514 |
| enum and fk | integration | AC-4, Notification.read_status:enum | 'SEEN' → rejected; unknown recipient → 23503 |

Command: `npx vitest run tests/integration/notification/notification-table.test.ts`

## Out of scope
- The foreign key on `organization_id` (ORG-002).
- Push delivery (Q-007).
