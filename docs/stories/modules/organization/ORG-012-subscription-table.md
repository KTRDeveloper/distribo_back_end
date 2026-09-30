---
id: ORG-012
title: Subscription table
module: organization
kind: technical
rev: 1
amends: []
size: XS
risk: low
depends_on: [ORG-001, FND-005]
read_first: [prisma/schema.prisma, tests/integration/organization/organization-table.test.ts]
design_refs: [finances/subscription]
constraints: ['Subscription:required', 'Subscription.status:enum', 'Subscription:fk', C-31, C-01]
asvs: [v5.0.0-2.2.3]
---

# ORG-012 — Subscription table

## Story
Technical story: create the subscription history table so that an organization has at most one active subscription.

## Context
- Exists: `organizations` (ORG-001).
- Adds: table `subscriptions` with a partial unique index on `organization_id` where `status = 'ACTIVE'`. It has no `server_updated_at` or `deleted_at`: it is not synchronized to phones.
- `Subscription` fields: `organization_id` FK → Organization; `plan` string; `status` enum [ACTIVE / EXPIRED]
- `Subscription:required`: NOT NULL: `organization_id`, `plan`, `status`
- `Subscription.status:enum`: one of ACTIVE, EXPIRED
- `Subscription:fk`: references organization_id → Organization
- `C-31`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); EXPIRED rows stay as history.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Row
  When a subscription is inserted with plan, status ACTIVE, starts_at and ends_at
  Then the row is stored
Scenario Outline: AC-2 One active subscription
  When an organization has <existing> and a row with status <new> is inserted
  Then the insert <result>
  Examples:
    | existing               | new     | result          |
    | no subscription        | ACTIVE  | accepts         |
    | one ACTIVE             | ACTIVE  | rejects (23505) |
    | one EXPIRED            | ACTIVE  | accepts         |
    | one ACTIVE             | EXPIRED | accepts         |
Scenario: AC-3 Required, enum, key
  When plan is null, status is "PAUSED" or the organization is unknown
  Then the insert fails
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `prisma/migrations/<timestamp>_org_012_subscriptions/migration.sql`, `tests/integration/organization/subscription-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: uniqueness of the active subscription is a database index.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| row | integration | AC-1, C-01 | stored; column types |
| one active | integration | AC-2, C-31 | each Examples row → accepted or 23505 |
| required enum key | integration | AC-3, Subscription:required, Subscription.status:enum, Subscription:fk | rejected |

Command: `npx vitest run tests/integration/organization/subscription-table.test.ts`

## Out of scope
- Starting and ending subscriptions (ORG-013, ORG-014).
