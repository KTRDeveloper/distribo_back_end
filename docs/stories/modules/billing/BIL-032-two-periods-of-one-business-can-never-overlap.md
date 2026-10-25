---
id: BIL-032
title: Two periods of one business can never overlap
module: billing
kind: migration
rev: 1
amends: []
size: XS
risk: high
depends_on: [BIL-002]
read_first: [prisma/schema.prisma, prisma/migrations/20261004120000_org_012_subscriptions/migration.sql]
design_refs: [finances/subscription, contraintes-a-poser-au-niveau-base-de]
constraints: [C-52]
asvs: [v5.0.0-2.2.3]
---

# BIL-032 — Two periods of one business can never overlap

## Story
Technical story: forbid overlapping periods of one business in the database, so that a double write never doubles the time a customer has paid for.

## Context
- Exists: `subscriptions` with `starts_at` and `ends_at` not null and a unique ACTIVE row per business (BIL-002).
- Migration `<timestamp>_bil_032_subscription_no_overlap`: `CREATE EXTENSION IF NOT EXISTS btree_gist`, then an exclusion constraint on (`organization_id` with `=`, `tstzrange(starts_at, ends_at)` with `&&`). Refusal is 23P01.
- Periods that touch (one ends when the next starts) are allowed. A period absorbed by an upgrade ends with `ends_at = starts_at`, an empty range that overlaps nothing.
- Add a sentence above `Subscription` in `prisma/schema.prisma`: two periods of one business never overlap, enforced by the migration; the schema cannot express it.
- `C-52`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); periods of one organization never overlap (exclusion constraint); `starts_at` is not after `ends_at`; `payment_id` and `months` are set exactly when `origin = PAYMENT`; `end_reason` is set exactly when `status = ENDED`; only the server writes it.

## Acceptance criteria
```gherkin
Scenario: AC-1 Back-to-back periods
  When two periods of one business are inserted, the second starting when the first ends
  Then both are stored
Scenario: AC-2 Overlap refused
  When a period starts inside another period of the same business
  Then the database refuses with 23P01 and one period exists
Scenario: AC-3 Other businesses and empty ranges
  When the same dates are used by another business, and when a SCHEDULED period is ended with `ends_at` equal to `starts_at`
  Then both succeed
```

## Abuse cases
```gherkin
Scenario: AB-1 Two writers each add the same month (tampering, T3)
  When two transactions insert periods starting inside each other for one business
  Then one commits and the other fails with 23P01
```

## Implementation
- Create: `prisma/migrations/<timestamp>_bil_032_subscription_no_overlap/migration.sql`, `tests/integration/billing/subscription-no-overlap.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the database, not each writer, keeps periods from overlapping.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| touching | integration | AC-1 | back-to-back periods → stored |
| overlap | integration | AC-2, C-52 | period inside another → 23P01 |
| scope | integration | AC-3 | other business, empty range → stored |
| parallel | security | AB-1, CWE-362 | two parallel inserts → one 23P01 |

Command: `npx vitest run tests/integration/billing/subscription-no-overlap.test.ts`

## Tests to update
| file | permitted change |
|---|---|
| `tests/integration/billing/subscriptions-table.test.ts` | Give the status-coexistence fixture non-overlapping dates; preserve every assertion. |

## Out of scope
- Choosing start dates: BIL-010 and BIL-011.
