---
id: ORG-002
title: Notifications point to organizations
module: organization
kind: change
rev: 1
amends: [NTF-001]
size: XS
risk: low
depends_on: [ORG-001, NTF-001]
read_first: [prisma/schema.prisma, tests/integration/notification/notification-table.test.ts]
design_refs: [notifications/notification]
constraints: ['Notification:fk']
asvs: [v5.0.0-2.2.3]
---

# ORG-002 — Notifications point to organizations

## Story
Technical story: add the foreign key from notifications to organizations, so that a notification's business context is always a real business.

## Context
- Exists: `notifications.organization_id` as a plain `uuid` column (NTF-001); `organizations` (ORG-001).
- Changes: a migration adds a foreign key `notifications.organization_id` to `organizations(id)`.
- `Notification:fk`: references recipient_id → Person; organization_id → Organization

## Acceptance criteria
```gherkin
Scenario: AC-1 Foreign key
  When a notification references an unknown organization id
  Then the insert fails with 23503
Scenario: AC-2 Valid and empty
  When it references an existing organization, or none
  Then the insert succeeds
Scenario: AC-3 Recipient key unchanged
  When a notification references an unknown recipient
  Then the insert still fails with 23503
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `prisma/migrations/<timestamp>_org_002_notification_org_fk/migration.sql`
- Modify: `prisma/schema.prisma`
- Pattern: `prisma/migrations/20260930210000_baseline/migration.sql`
- Dependencies: `prisma`

## Security
- v5.0.0-2.2.3: referential integrity in the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| unknown organization | integration | AC-1, Notification:fk | 23503 |
| valid and empty | integration | AC-2 | accepted |
| recipient key | integration | AC-3, Notification:fk | 23503 |

Command: `npx vitest run tests/integration/notification/notification-table.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/notification/notification-table.test.ts | inserts notifications with a random organization id, if it does | use an existing organization or none |

## Out of scope
- Anything else about notifications.
