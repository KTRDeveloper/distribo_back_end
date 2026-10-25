---
id: BIL-002
title: The subscriptions table holds prepaid periods
module: billing
kind: migration
rev: 1
amends: [ORG-012]
size: M
risk: high
depends_on: [BIL-001, BIL-005]
read_first: [prisma/schema.prisma, prisma/migrations/20261004120000_org_012_subscriptions/migration.sql]
design_refs: [finances/subscription, contraintes-a-poser-au-niveau-base-de]
constraints: ['Subscription:required', 'Subscription.plan:enum', 'Subscription.origin:enum', 'Subscription.status:enum', 'Subscription.end_reason:enum', 'Subscription:fk', C-52]
asvs: [v5.0.0-2.2.3]
---

# BIL-002 — The subscriptions table holds prepaid periods

## Story
Technical story: rebuild the subscriptions table as prepaid periods with the rules that keep one period running at a time, so that no writer can store a plan that makes no sense.

## Context
- Exists: `subscriptions` with `plan` text, status ACTIVE or EXPIRED and nullable dates (ORG-012), no longer written (BIL-005); `PaidPlan` and `subscription_payments` (BIL-001).
- Migration `<timestamp>_bil_002_subscription_periods`: (1) preflight `DO` block: any row raises an error with the count and at most 20 ids (old rows have no price or payment, nothing is invented); (2) drop the table and the old `SubscriptionStatus`; (3) create `SubscriptionStatus` (SCHEDULED, ACTIVE, ENDED), `SubscriptionOrigin` (PAYMENT, CONVERSION, GIFT), `SubscriptionEndReason` (EXPIRED, UPGRADED, CLOSED, REFUNDED); (4) create the new `subscriptions`, dates not null.
- Unique: one ACTIVE row per `organization_id`; one row per `payment_id` when set. The no-overlap rule is BIL-032.
- Checks (23514): `starts_at` not after `ends_at`; `months` 1, 3, 6 or 12 when set; `payment_id` and `months` set exactly when `origin` is PAYMENT; `end_reason` set exactly when `status` is ENDED; `price` 0 unless `origin` is PAYMENT.
- GRANT SELECT, INSERT, UPDATE; DELETE and TRUNCATE revoked. `prisma/schema.prisma`: enums and model, with the `//` comment above `Subscription` rewritten in plain words (one running period, no overlap, the payment rule, only the server writes, the migration).
- `Subscription:required`: NOT NULL: `organization_id`, `plan`, `price`, `origin`, `status`, `created_at`
- `Subscription.plan:enum`: one of ESSENTIAL, PRO, ENTERPRISE
- `Subscription.origin:enum`: one of PAYMENT, CONVERSION, GIFT
- `Subscription.status:enum`: one of SCHEDULED, ACTIVE, ENDED
- `Subscription.end_reason:enum`: one of EXPIRED, UPGRADED, CLOSED, REFUNDED
- `Subscription:fk`: references organization_id → Organization; payment_id → SubscriptionPayment
- `C-52`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); periods of one organization never overlap (exclusion constraint); `starts_at` is not after `ends_at`; `payment_id` and `months` are set exactly when `origin = PAYMENT`; `end_reason` is set exactly when `status = ENDED`; only the server writes it.

## Acceptance criteria
```gherkin
Scenario: AC-1 The preflight stops on an old row
  Given a scratch table `subscriptions(id uuid)` first in `search_path` holding two rows
  When the preflight runs
  Then it raises an error with the count 2 and the two ids; with no row it succeeds
Scenario: AC-2 Valid periods
  When a PAYMENT period (PRO, 3 months, 30 000, with its payment), a CONVERSION period and a GIFT period (price 0) are inserted
  Then all three are stored
Scenario Outline: AC-3 Wrong rows are refused
  When a row is inserted with <problem>
  Then the database refuses it with <code>
  Examples:
    | problem                                         | code  |
    | a second ACTIVE period for the business         | 23505 |
    | `starts_at` after `ends_at`                     | 23514 |
    | PAYMENT without a payment                       | 23514 |
    | CONVERSION with a price                         | 23514 |
    | ENDED without `end_reason`                      | 23514 |
Scenario: AC-4 Periods are never deleted
  When the application account deletes or truncates the table
  Then each statement fails with 42501
```

## Abuse cases
```gherkin
Scenario: AB-1 One payment buys two periods (tampering, T3)
  When a second period uses the payment of an existing period
  Then the database refuses with 23505 and one period exists
```

## Implementation
- Create: `prisma/migrations/<timestamp>_bil_002_subscription_periods/migration.sql`, `tests/integration/billing/subscriptions-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the database refuses inconsistent periods whatever the writer does; the preflight message names ids only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| preflight | integration | AC-1 | two scratch rows → error with count and ids; none → passes |
| valid periods | integration | AC-2, Subscription:required, Subscription.plan:enum, Subscription.origin:enum, Subscription.status:enum, Subscription.end_reason:enum, Subscription:fk | three periods → stored |
| wrong rows | integration | AC-3, C-52 | each Examples row → the code |
| no delete | integration | AC-4 | DELETE, TRUNCATE → 42501 |
| same payment | security | AB-1, CWE-362 | second period with the same payment → 23505 |

Command: `npx vitest run tests/integration/billing/subscriptions-table.test.ts tests/integration/organization`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/subscription-table.test.ts | inserts the old shape (plan text, status ACTIVE or EXPIRED, nullable dates) | file deleted; subscriptions-table.test.ts covers the new shape |
| tests/integration/organization/reopen.test.ts | seeds a `subscriptions` row of the old shape (plan 'BASIC', status EXPIRED) and expects it unchanged after reopening | the seed is dropped with the assertion on it |
| tests/integration/organization/subscription-routes-removed.test.ts | its `beforeEach` seeds a `subscriptions` row of the old shape (plan 'BASIC'), which the new plan enum rejects | the seed becomes plan 'PRO', origin 'GIFT', price 0, status 'ACTIVE'; the assertions stay unchanged |

## Out of scope
- Writing periods: BIL-011, BIL-014, BIL-023. The no-overlap rule: BIL-032.
