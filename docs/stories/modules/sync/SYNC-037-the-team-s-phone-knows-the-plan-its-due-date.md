---
id: SYNC-037
title: The team's phone knows the plan, its due date and its limits
module: sync
kind: change
rev: 1
amends: [SYNC-003]
size: S
risk: medium
depends_on: [SYNC-003, ORG-020, BIL-013]
read_first: [src/modules/sync/adapters/identity.adapter.ts, tests/integration/sync/pull-identity.test.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, identite-et-organisation/organization]
constraints: [C-41]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# SYNC-037 — The team's phone knows the plan, its due date and its limits

## Story
As a manager, I want my business's plan, due date and limits on my phone, so that I know offline why a product or a seat is paused.

## Context
- Exists: `organizationsAdapter` sends only the viewer's ACTIVE organizations, with `id, name, description, email, status, created_at, server_updated_at` (SYNC-003); the plan columns (ORG-020), recomputed by billing (BIL-013), which moves `server_updated_at` with them.
- The row gains `payment_code`, `plan`, `plan_ends_at` and `grace_ends_at` (epoch milliseconds or null), `max_collaborators` and `max_products` (integers, null when unlimited). Every ACTIVE member of the business receives them, a driver too, read-only: the push of the table stays refused.
- The adapter never returns an organization the viewer is not a member of, so a customer or a supplier of the business receives none of these fields.
- Subscription tables stay out of the synchronization. What is paused travels already: `Product.paused_at` (SYNC-024) and the collaboration `status` (SYNC-003).
- `C-41`: `Organization.plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only.
- `C-41`: `Organization.plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only.

## Acceptance criteria
```gherkin
Scenario: AC-1 The team
  Given a PRO business due on 2027-01-12 with 10 collaborators and no product limit
  When its OWNER, a SELLER and a DRIVER pull
  Then each row carries the plan `PRO`, the due date, `grace_ends_at` null, `max_collaborators` 10, `max_products` null and the payment code
Scenario: AC-2 The free plan
  Given a FREE business
  Then `plan_ends_at` is null, `max_collaborators` is 2 and `max_products` is 30
Scenario: AC-3 During the grace
  Given the due date passed 3 days ago
  Then `grace_ends_at` is set and the plan is unchanged
Scenario: AC-4 A renewal
  When a payment renews the plan after the last pull
  Then the organization is in `updated` with the new due date
Scenario: AC-5 Read-only
  When a phone pushes an organization row with another `plan`
  Then the line is forbidden `SYNC_TABLE_READ_ONLY` and the plan is unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 A customer or a supplier reads the plan (information disclosure, T10)
  When a customer business, a particular customer and a supplier of the business pull
  Then no organization row of it, and no plan field, is in their answers
```

## Implementation
- Create: `tests/integration/sync/pull-plan-fields.test.ts`
- Modify: `src/modules/sync/adapters/identity.adapter.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the organizations come from the viewer's ACTIVE memberships only.
- v5.0.0-15.3.1: the six fields join an explicit list; no whole row is serialized.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| team | integration | AC-1, C-41 | three roles, six fields |
| free plan | integration | AC-2 | null date, limits |
| grace | integration | AC-3 | grace date |
| renewal | integration | AC-4 | updated row |
| read-only | integration | AC-5 | forbidden, unchanged |
| other side | security | AB-1, CWE-200 | no row, no field |

Command: `npx vitest run tests/integration/sync/pull-plan-fields.test.ts tests/integration/sync/pull-identity.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-identity.test.ts | checks the ids of the organizations pulled and the keys of the people rows, not those of the organization rows | unchanged |

## Out of scope
- Logo and photo addresses: SYNC-038.
