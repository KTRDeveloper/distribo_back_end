---
id: NTF-003
title: Person lists their notifications
module: notification
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [NTF-002, FND-009]
read_first:
  - docs/stories/modules/notification/contracts.md
  - src/shared/pagination.ts
  - src/middleware/auth.ts
  - src/types/express.d.ts
  - src/modules/tasks/tasks.controller.ts
  - src/modules/tasks/tasks.routes.ts
  - src/modules/tasks/tasks.openapi.ts
  - tests/helpers/request.ts
  - tests/integration/notification/notify.test.ts
design_refs: [notifications/notification]
constraints: []
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# NTF-003 — Person lists their notifications

## Story
As a customer, I want to list my notifications, newest first, so that I see what changed on my account.

## Context
- Exists: `notify` (NTF-002); `paginationQuerySchema` and cursors (FND-009); `authMiddleware`.
- The authenticated recipient identity is `req.user.id`.
- Adds: `GET /api/v1/notifications?limit&cursor&unread=true`. Response `{ items: [{ id, organization_id, content, source_event, related_entity_type, related_entity_id, read_status, created_at }], next_cursor }`. Rows with `deleted_at` are excluded.

## Acceptance criteria
```gherkin
Scenario: AC-1 Own notifications, newest first
  Given a person with 3 notifications
  When they GET /api/v1/notifications
  Then the response is 200 with 3 items ordered by created_at descending
Scenario: AC-2 Unread filter
  When they GET with unread=true after reading one
  Then only unread items are returned
Scenario: AC-3 Pagination
  Given 5 notifications
  When they GET with limit 2, then with the returned next_cursor
  Then the pages hold 2, 2 and 1 items with no repeat
```

## Abuse cases
```gherkin
Scenario: AB-1 Another person's notifications (horizontal)
  Given notifications for person B
  When person A lists notifications
  Then none of B's rows appear
Scenario: AB-2 No token (unauthenticated)
  When the request has no valid access token
  Then the response is 401
```

## Implementation
- Create: `src/modules/notification/notification.routes.ts`, `src/modules/notification/notification.schemas.ts`, `src/modules/notification/notification.openapi.ts`, `tests/integration/notification/list.test.ts`
- Modify: `src/modules/notification/notification.repository.ts`, `src/app.ts`
- Pattern: `src/modules/tasks/tasks.routes.ts`
- Signatures:
  - `listNotifications(personId: string, query: ListQuery): Promise<{ items: NotificationView[]; next_cursor: string | null }>`
- Types:
  - `ListQuery = { limit: number; cursor?: string; unread?: boolean }`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.2: the query filters on `recipient_id` from the session.
- v5.0.0-15.3.1: response built from the listed fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| own rows | integration | AC-1 | 3 rows → 3 items, descending |
| unread filter | integration | AC-2 | one read → 2 items |
| paging | integration | AC-3 | limit 2 → 2, 2, 1 without repeats |
| other person | security | AB-1, WSTG-ATHZ-04 | B's rows never appear for A |
| no token | security | AB-2, WSTG-ATHN-04 | no header → 401 |

Command: `npx vitest run tests/integration/notification/list.test.ts`

## Out of scope
- Marking as read (NTF-004).
