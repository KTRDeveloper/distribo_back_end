---
id: ORG-001
title: Organizations table
module: organization
kind: technical
rev: 1
amends: []
size: XS
risk: low
depends_on: [PER-002, FND-002, FND-005, NTF-001]
read_first: [prisma/schema.prisma, tests/integration/notification/notification-table.test.ts]
design_refs: [identite-et-organisation/organization, contraintes-a-poser-au-niveau-base-de]
constraints: ['Organization:required', 'Organization.status:enum', C-01, C-35]
asvs: [v5.0.0-2.2.3]
---

# ORG-001 — Organizations table

## Story
Technical story: create the organizations table so that businesses can exist.

## Context
- Exists: `set_server_updated_at()` (FND-002), `expectColumnType` (FND-005).
- Adds: table `organizations` with `server_updated_at` and `deleted_at`, status default ACTIVE, `created_at` default now. There is no owner column: ownership is the OWNER collaboration (ORG-003).
- `Organization` fields: `name` string; `description` text, nullable; `email` string, nullable; `status` enum [ACTIVE / SUSPENDED / CLOSED]; `created_at` datetime
- `Organization:required`: NOT NULL: `name`, `status`, `created_at`
- `Organization.status:enum`: one of ACTIVE, SUSPENDED, CLOSED
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Row with defaults
  When an organization is inserted with a name
  Then `status` is ACTIVE, `created_at` and `server_updated_at` are set, description and email are empty
Scenario Outline: AC-2 Required and enum
  When a row has <values>
  Then the insert <result>
  Examples:
    | values                    | result          |
    | name empty (null)         | rejects (23502) |
    | status SUSPENDED          | accepts         |
    | status CLOSED             | accepts         |
    | status "DELETED"          | rejects         |
Scenario: AC-3 Server time
  When a row is updated
  Then `server_updated_at` moves forward
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `prisma/migrations/<timestamp>_org_001_organizations/migration.sql`, `tests/integration/organization/organization-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/notification/notification-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: status values are enforced by the database enum.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| defaults | integration | AC-1, C-01 | insert → defaults; column types |
| required and enum | integration | AC-2, Organization:required, Organization.status:enum | each Examples row → accepted or rejected |
| server time | integration | AC-3, C-35 | update → later server_updated_at |

Command: `npx vitest run tests/integration/organization/organization-table.test.ts`

## Out of scope
- Collaboration table (ORG-003). Creating organizations (ORG-004).
