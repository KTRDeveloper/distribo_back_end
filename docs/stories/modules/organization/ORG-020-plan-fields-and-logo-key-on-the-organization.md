---
id: ORG-020
title: Plan fields and logo key on the organization
module: organization
kind: migration
rev: 1
amends: [ORG-001]
size: M
risk: high
depends_on: [ORG-001, FND-014]
read_first: [prisma/schema.prisma, tests/integration/organization/organization-table.test.ts]
design_refs: [identite-et-organisation/organization, contraintes-a-poser-au-niveau-base-de]
constraints: [C-41, 'Organization.plan:enum', 'Organization.payment_code:unique', C-49]
asvs: [v5.0.0-2.2.3]
---

# ORG-020 — Plan fields and logo key on the organization

## Story
Technical story: add to the organizations table the logo key, the business code and the plan fields, with the database rules that keep them consistent, and give every existing business the free plan and a code.

## Context
- Exists: `organizations` (ORG-001); `PLANS.FREE` (FND-014): 2 collaborators, 30 products.
- Adds one migration, run in one transaction: `logo_key` (text, empty, unique); `payment_code` (text, not null, unique); `plan` (new type `OrganizationPlan`, default FREE); `plan_ends_at` and `grace_ends_at` (timestamptz, empty); `max_collaborators` (integer, default 2) and `max_products` (integer, default 30), empty = no limit.
- A SQL function `organization_payment_code()` returns 8 characters of `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, drawn from the bytes of `gen_random_uuid()` (secure, no bias). It is the default of `payment_code` and fills existing rows before the column becomes not null.
- CHECKs (C-41): `plan = 'FREE'` exactly when `plan_ends_at` is empty; a set `grace_ends_at` needs `plan_ends_at` and is later; the two limits are zero or more.
- Existing rows get FREE, empty dates, 2 and 30: every rule holds.
- `prisma/schema.prisma`: add the fields and the enum to `model Organization` and its `//` comment, in plain words: the server alone writes the plan fields and the code, shown to the team only; a free business has no end date; codes and logo files are unique; migration `org_020_organization_plan_fields`.
- `Organization` fields: `logo_key` string, nullable; `payment_code` string, unique; `plan` enum [FREE / ESSENTIAL / PRO / ENTERPRISE]; `plan_ends_at` datetime, nullable; `grace_ends_at` datetime, nullable; `max_collaborators` int, nullable; `max_products` int, nullable
- `C-41`: `Organization.payment_code` is unique; `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only; `plan = FREE` exactly when `plan_ends_at` is empty; a set `grace_ends_at` is after `plan_ends_at`.
- `Organization.plan:enum`: one of FREE, ESSENTIAL, PRO, ENTERPRISE
- `Organization.payment_code:unique`: unique
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario: AC-1 Defaults
  When an organization is inserted with a name only
  Then `plan` is FREE, `max_collaborators` is 2, `max_products` is 30, `plan_ends_at`, `grace_ends_at` and `logo_key` are empty
  And `payment_code` has 8 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`
Scenario: AC-2 Each row gets its own code
  When two organizations are inserted without a code
  Then their `payment_code` values differ
Scenario Outline: AC-3 Plan rules
  When a row has <values>
  Then the database <result>
  Examples:
    | values | result |
    | plan ESSENTIAL with plan_ends_at set | accepts |
    | plan ESSENTIAL without plan_ends_at | rejects (23514) |
    | plan FREE with plan_ends_at set | rejects (23514) |
    | grace_ends_at before plan_ends_at | rejects (23514) |
    | max_collaborators -1 | rejects (23514) |
    | plan GOLD | rejects (22P02) |
Scenario: AC-4 One code, one business
  When two organizations are given the same `payment_code`
  Then the second insert is rejected with 23505
Scenario: AC-5 One logo file, one business
  When two organizations are given the same `logo_key`
  Then the second insert is rejected with 23505
  And any number of organizations may have an empty key
```

## Abuse cases
```gherkin
Scenario: AB-1 A plan granted without an end date (elevation)
  When code sets `plan = 'PRO'` and leaves `plan_ends_at` empty, straight in the database
  Then PostgreSQL rejects it with 23514, even though no application check ran
```

## Implementation
- Create: `prisma/migrations/<timestamp>_org_020_organization_plan_fields/migration.sql`, `tests/integration/organization/organization-plan-fields.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: related columns (`plan`, `plan_ends_at`, `grace_ends_at`) are checked together in the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| defaults | integration | AC-1 | insert with a name → FREE, 2, 30, empty dates, code of 8 allowed characters |
| own code | integration | AC-2, C-41 | two inserts without a code → two different codes |
| plan rules | integration | AC-3, C-41, Organization.plan:enum | each Examples row → accepted or 23514 |
| unique code | integration | AC-4, C-41, Organization.payment_code:unique | same code twice → 23505 |
| unique logo key | integration | AC-5, C-49 | same key twice → 23505; two empty keys → accepted |
| plan without end date | security | AB-1, CWE-20 | raw update to PRO without plan_ends_at → 23514 |

Command: `npx vitest run tests/integration/organization/organization-plan-fields.test.ts`

## Out of scope
- The writers of the plan fields (ORG-035), the logo key (ORG-038) and the code at creation (ORG-028); sending the fields to the team only (ORG-028, SYNC); the cross-table key rule (IMG-006).
