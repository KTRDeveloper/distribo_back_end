---
id: ADM-003
title: Reports table
module: admin
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [ADM-002, PER-008]
read_first: [prisma/schema.prisma, tests/integration/admin/admin-action-table.test.ts]
design_refs: [moderation/report, contraintes-a-poser-au-niveau-base-de]
constraints: ['Report:required', 'Report.status:enum', 'Report.decision:enum', 'Report:fk', C-28, C-04]
asvs: [v5.0.0-2.2.3]
---

# ADM-003 — Reports table

## Story
Technical story: create the reports table and the foreign key from the journal to it, so that users can flag abuse and decisions link to their report.

## Context
- Exists: `admin_actions` (ADM-002), `administrators`, `require_registered_person()`.
- Adds: table `reports` (`status` default PENDING, `reported_at` default now, `resolved_at` null, `server_updated_at`), triggers `require_registered_person('reporter_id')` and `set_server_updated_at()`, CHECK exactly one of `target_person_id` and `target_organization_id`; the foreign key `admin_actions.report_id` to `reports(id)`.
- `resolved_by_id` references `administrators(id)`.
- `Report` fields: `reporter_id` FK → Person; `target_person_id` FK → Person, nullable; `target_organization_id` FK → Organization, nullable; `reason` string; `description` text; `status` enum [PENDING / RESOLVED]; `resolved_by_id` FK → Administrator, nullable; `decision` enum [DISMISSED / SUSPENSION], nullable
- `Report:required`: NOT NULL: `reporter_id`, `reason`, `description`, `status`
- `Report.status:enum`: one of PENDING, RESOLVED
- `Report.decision:enum`: one of DISMISSED, SUSPENSION
- `Report:fk`: references reporter_id → Person; target_person_id → Person; target_organization_id → Organization; resolved_by_id → Administrator
- `C-28`: A report has exactly one target, a person or an organization.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Insert rules
  When a report is inserted with <values>
  Then the insert <result>
  Examples:
    | values                                           | result          |
    | a registered reporter and a person target        | accepts         |
    | a registered reporter and an organization target | accepts         |
    | both targets                                     | rejects (23514) |
    | no target                                        | rejects (23514) |
    | a guest reporter                                 | rejects (23514) |
    | status "OPEN"                                    | rejects         |
    | decision "BAN"                                   | rejects         |
Scenario: AC-2 Defaults and keys
  Then a new report is PENDING with reported_at set, `resolved_by_id` accepts only an existing administrator, and `admin_actions.report_id` accepts only an existing report
```

## Abuse cases
```gherkin
Scenario: AB-1 A report with two targets by a crafted write (tampering)
  When code inserts both targets
  Then PostgreSQL refuses it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_adm_003_reports/migration.sql`, `tests/integration/admin/report-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/admin/administrator-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: exactly one target is a CHECK.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| insert rules | integration | AC-1, C-28, C-04, Report:required, Report.status:enum, Report.decision:enum | each Examples row → accepted or rejected |
| defaults and keys | integration | AC-2, Report:fk | as described |
| two targets | security | AB-1, CWE-20 | refused |

Command: `npx vitest run tests/integration/admin/report-table.test.ts`

## Out of scope
- Creating and resolving reports (ADM-011, ADM-013).
