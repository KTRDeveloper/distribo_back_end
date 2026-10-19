---
id: BIL-001
title: Table of subscription payments
module: billing
kind: migration
rev: 1
amends: []
size: M
risk: high
depends_on: [ORG-020]
read_first: [prisma/schema.prisma, prisma/migrations/20261004180000_adm_002_admin_actions/migration.sql]
design_refs: [finances/subscriptionpayment, contraintes-a-poser-au-niveau-base-de]
constraints: ['SubscriptionPayment:required', 'SubscriptionPayment.provider_reference:unique', 'SubscriptionPayment.plan:enum', 'SubscriptionPayment.operator:enum', 'SubscriptionPayment.status:enum', 'SubscriptionPayment:fk', C-53]
asvs: [v5.0.0-2.2.3]
---

# BIL-001 — Table of subscription payments

## Story
Technical story: create the table of payment requests with the rules that stop a payment from being changed or counted twice, so that no later writer can bypass them.

## Context
- Exists: `organizations` (ORG-020). No payment table.
- One migration creates enums `PaidPlan` (ESSENTIAL, PRO, ENTERPRISE; BIL-002 reuses it), `PaymentOperator`, `PaymentStatus` and table `subscription_payments` (`status` default PENDING, `created_at` default now(), `provider_payload` jsonb, indexes on (`organization_id`, `created_at`) and (`status`, `created_at`)).
- Checks (23514): `amount` above 0; `months` 1, 3, 6 or 12; `confirmed_at` set exactly when `status` is SUCCEEDED or REFUNDED; `payer_phone_number` empty exactly when `operator` is OTHER.
- Trigger `subscription_payments_check_update` (23514): a status moves only from PENDING to another value or from SUCCEEDED to REFUNDED; only `status`, `provider_payload` and `confirmed_at` may change.
- GRANT SELECT, INSERT, UPDATE; DELETE and TRUNCATE revoked (the purge, PRIV, uses the migration account).
- `prisma/schema.prisma`: enums, model and, above it, a plain-words `//` comment: a payment only moves forward, amount and plan never change, the reference is unique, and the migration.
- `SubscriptionPayment:required`: NOT NULL: `organization_id`, `plan`, `months`, `amount`, `operator`, `provider_reference`, `status`, `terms_version`, `created_at`
- `SubscriptionPayment.provider_reference:unique`: unique
- `SubscriptionPayment.plan:enum`: one of ESSENTIAL, PRO, ENTERPRISE
- `SubscriptionPayment.operator:enum`: one of MTN_MOMO, ORANGE_MONEY, OTHER
- `SubscriptionPayment.status:enum`: one of PENDING, SUCCEEDED, FAILED, EXPIRED, REFUNDED
- `SubscriptionPayment:fk`: references organization_id → Organization
- `C-53`: `SubscriptionPayment`: `provider_reference` is unique; `months` is 1, 3, 6 or 12; `amount` is computed by the server from the price grid; status moves only from PENDING to another value, then from SUCCEEDED to REFUNDED; `confirmed_at` is set exactly when status is SUCCEEDED or REFUNDED; `operator = OTHER` exactly when an administrator recorded the payment, and `payer_phone_number` is set otherwise.

## Acceptance criteria
```gherkin
Scenario: AC-1 A pending payment
  When a payment of 15 000, ESSENTIAL, 3 months, MTN_MOMO, with a payer number is inserted
  Then it is stored with status PENDING and `confirmed_at` empty
Scenario Outline: AC-2 Wrong rows are refused
  When a row is inserted with <problem>
  Then the database refuses it with <code>
  Examples:
    | problem                            | code  |
    | months 2, or amount 0              | 23514 |
    | operator OTHER with a payer number | 23514 |
    | SUCCEEDED and no `confirmed_at`    | 23514 |
    | plan FREE                          | 22P02 |
    | no `terms_version`                 | 23502 |
Scenario Outline: AC-3 Status moves
  When a row in <from> is updated to <to>
  Then the update <result>
  Examples:
    | from      | to         | result       |
    | PENDING   | SUCCEEDED  | succeeds     |
    | SUCCEEDED | REFUNDED   | succeeds     |
    | SUCCEEDED | PENDING    | fails 23514  |
    | FAILED    | SUCCEEDED  | fails 23514  |
Scenario: AC-4 Frozen columns
  When `amount`, `plan`, `months`, `provider_reference` or `payer_phone_number` of a stored row is updated
  Then each update fails with 23514
Scenario: AC-5 No delete
  When the application account deletes or truncates the table
  Then each statement fails with 42501
```

## Abuse cases
```gherkin
Scenario: AB-1 A confirmed payment is replayed (tampering, T3)
  When SQL sets a SUCCEEDED payment back to PENDING
  Then the database refuses with 23514 and the row is unchanged
Scenario: AB-2 The same transaction is recorded twice (tampering, T3)
  When a second payment has the same `provider_reference`
  Then the database refuses with 23505 and one row exists
```

## Implementation
- Create: `prisma/migrations/<timestamp>_bil_001_subscription_payments/migration.sql`, `tests/integration/billing/subscription-payments-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the database holds the rules, so every writer obeys them: no delete, no change of money fields, no status regression.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| pending | integration | AC-1 | insert the payment → PENDING, date set |
| wrong rows | integration | AC-2, SubscriptionPayment:required, SubscriptionPayment.provider_reference:unique, SubscriptionPayment.plan:enum, SubscriptionPayment.operator:enum, SubscriptionPayment.status:enum, SubscriptionPayment:fk | each Examples row → the code |
| moves | integration | AC-3, C-53 | each Examples row → result |
| frozen | integration | AC-4 | each update → 23514 |
| no delete | integration | AC-5 | DELETE and TRUNCATE as the application role → 42501 |
| replay | security | AB-1, CWE-345 | SUCCEEDED → PENDING → 23514 |
| duplicate | security | AB-2, CWE-362 | same reference twice → 23505 |

Command: `npx vitest run tests/integration/billing/subscription-payments-table.test.ts`

## Out of scope
- Writing payments: BIL-009, BIL-014. Purging old requests: PRIV.
