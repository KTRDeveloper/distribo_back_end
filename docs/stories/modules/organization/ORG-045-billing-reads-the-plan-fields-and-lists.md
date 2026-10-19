---
id: ORG-045
title: Billing reads the plan fields and lists businesses by plan date
module: organization
kind: technical
rev: 1
amends: []
size: XS
risk: low
depends_on: [ORG-044]
read_first: [src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/organization]
constraints: [C-41, C-42]
asvs: [v5.0.0-8.2.1]
---

# ORG-045 — Billing reads the plan fields and lists businesses by plan date

## Story
Technical story: let billing read the plan fields of a business and list, page by page, the businesses whose plan dates are past or near, or whose team is larger than their limit, so that its daily jobs touch only those.

## Context
- Exists: the plan columns and `listTeamSeats` (ORG-035), in `organization.repository.ts`.
- Adds `readPlanFields(tx, organizationId)`: the five plan fields (`PlanFields`, ORG-035) of a non-deleted business, else null. Billing compares them with the new rights to journal a change (BIL-028).
- Adds `listOrganizationsToRefresh(now, limit, afterId?)`: the ids of non-deleted businesses, ascending by id, after `afterId`, at most `limit` (1 to 500), that match one of:
  - the plan is not FREE and `COALESCE(grace_ends_at, plan_ends_at)` is not after `now`;
  - `max_collaborators` is set and the non-owner collaborations ACTIVE or INVITED number more than it.
- Adds `listOrganizationsEnding(from, to, limit, afterId?)`: the same kind of page for non-deleted businesses whose plan is not FREE and `plan_ends_at` is at or after `from` and before `to`.
- All three read only; the callers act on each business in its own transaction (BIL-039, BIL-026). The contract lists them for billing, shipped before their callers.
- `C-41`: `Organization.payment_code` is unique; `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only; `plan = FREE` exactly when `plan_ends_at` is empty; a set `grace_ends_at` is after `plan_ends_at`.
- `C-42`: At each invitation, the ACTIVE or INVITED collaborators of an organization, owner excluded, number at most `Organization.max_collaborators`; the status PAUSED is written by the server only and never for the OWNER.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Who is listed
  Given a business with <state>
  When `listOrganizationsToRefresh` runs
  Then the business is <listed>
  Examples:
    | state                                                  | listed     |
    | ESSENTIAL and `plan_ends_at` in the past, no grace     | listed     |
    | ESSENTIAL in grace until a future date                 | not listed |
    | ESSENTIAL and `grace_ends_at` in the past              | listed     |
    | PRO until a future date, 3 seats, limit 10             | not listed |
    | limit 2 and 3 seats ACTIVE or INVITED                  | listed     |
    | limit 2, 1 ACTIVE seat and 2 PAUSED ones              | not listed |
    | FREE, limit 2, 2 seats                                 | not listed |
    | a deleted business that would be listed                | not listed |
Scenario: AC-2 Pages
  Given 5 businesses to refresh
  When the function runs with `limit` 2, then with the last id it returned
  Then it returns 2 ids, then the next 2 ids, ascending, and the third call returns the last one
Scenario: AC-3 Ending between two dates
  Given businesses ending before, at, inside and at the end of the range, a FREE one, and a deleted one
  When `listOrganizationsEnding(from, to, 10)` runs
  Then it returns the ones ending at `from` or inside, ascending by id, and no other
Scenario: AC-4 The plan fields
  When `readPlanFields` runs for a business, a deleted one and an unknown id
  Then it returns the five fields of the first and null for the other two
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/organization/refresh-list.test.ts`
- Modify: `src/modules/organization/organization.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `readPlanFields(tx: Prisma.TransactionClient, organizationId: string): Promise<PlanFields | null>`
  - `listOrganizationsToRefresh(now: Date, limit: number, afterId?: string): Promise<string[]>`
  - `listOrganizationsEnding(from: Date, to: Date, limit: number, afterId?: string): Promise<string[]>`
- Dependencies: none added

## Security
- v5.0.0-8.2.1: the lists return ids only and no route exposes any of the three functions.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| who | integration | AC-1, C-41, C-42 | each Examples row → listed or not |
| pages | integration | AC-2 | limit 2 → ids ascending, no repeat |
| ending | integration | AC-3 | range [from, to) → ids, FREE and deleted left out |
| plan fields | integration | AC-4 | five fields, null for deleted and unknown |

Command: `npx vitest run tests/integration/organization/refresh-list.test.ts`

## Out of scope
- Refreshing the rights and the daily job: BIL-028, BIL-039.
