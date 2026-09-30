---
id: NTF-004
title: Person marks notifications as read
module: notification
kind: feature
rev: 1
amends: []
size: XS
risk: medium
depends_on: [NTF-003]
read_first: [docs/stories/modules/notification/contracts.md, src/modules/notification/notification.routes.ts]
design_refs: [notifications/notification]
constraints: ['Notification.read_status:enum']
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# NTF-004 — Person marks notifications as read

## Story
As a customer, I want to mark my notifications as read so that I see only what is new.

## Context
- Exists: `GET /api/v1/notifications` (NTF-003).
- Adds: `POST /api/v1/notifications/{id}/read` (204, idempotent) and `POST /api/v1/notifications/read-all` (204). Only `read_status` changes; no other field is writable.
- `Notification.read_status:enum`: one of UNREAD, READ

## Acceptance criteria
```gherkin
Scenario: AC-1 Mark one
  When a person posts to /api/v1/notifications/{id}/read for their own unread notification
  Then the response is 204 and `read_status` is READ
  And a second identical call is also 204
Scenario: AC-2 Mark all
  When a person posts to /api/v1/notifications/read-all
  Then every unread notification of that person is READ and other people's are unchanged
Scenario: AC-3 Unknown id
  When the id does not exist or is not a UUID
  Then the response is 404 `NOT_FOUND` or 400 `VALIDATION_ERROR`
```

## Abuse cases
```gherkin
Scenario: AB-1 Another person's notification (horizontal)
  When person A posts to read a notification of person B
  Then the response is 404 and B's row is unchanged
Scenario: AB-2 Writing other fields (mass assignment)
  When the body contains content or recipient_id
  Then the response is 400 and nothing changes
```

## Implementation
- Create: `tests/integration/notification/read.test.ts`
- Modify: `src/modules/notification/notification.routes.ts`, `src/modules/notification/notification.service.ts`, `src/modules/notification/notification.repository.ts`, `src/modules/notification/notification.openapi.ts`
- Pattern: `src/modules/notification/notification.routes.ts`
- Signatures:
  - `markRead(personId: string, id: string): Promise<void>`
  - `markAllRead(personId: string): Promise<void>`
- Errors: `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: the update filters on `id` and `recipient_id` together.
- v5.0.0-15.3.3: the routes take no body fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| mark one | integration | AC-1, Notification.read_status:enum | own unread → 204, READ, repeat 204 |
| mark all | integration | AC-2 | all own READ, other person's still UNREAD |
| bad id | integration | AC-3 | unknown UUID → 404; 'abc' → 400 |
| other person | security | AB-1, WSTG-ATHZ-04 | A reads B's id → 404, unchanged |
| extra fields | security | AB-2, CWE-915 | body with content → 400 |

Command: `npx vitest run tests/integration/notification/read.test.ts`

## Out of scope
- Deleting notifications.
