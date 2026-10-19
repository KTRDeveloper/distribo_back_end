---
id: BIL-004
title: Table of subscription events
module: billing
kind: migration
rev: 1
amends: []
size: S
risk: high
depends_on: [BIL-001, BIL-002, ADM-002]
read_first: [prisma/schema.prisma, prisma/migrations/20261004180000_adm_002_admin_actions/migration.sql]
design_refs: [finances/subscriptionevent, contraintes-a-poser-au-niveau-base-de]
constraints: ['SubscriptionEvent:required', 'SubscriptionEvent.kind:enum', 'SubscriptionEvent.actor:enum', 'SubscriptionEvent:fk', C-55, C-39]
asvs: [v5.0.0-2.2.3]
---

# BIL-004 — Table of subscription events

## Story
Technical story: create the append-only journal of everything that happens to a plan, with the rules that tie each event to who caused it.

## Context
- Exists: `subscription_payments` (BIL-001), `subscriptions` (BIL-002), `admin_actions` and `administrators` (ADM-001, ADM-002).
- Migration `<timestamp>_bil_004_subscription_events`: enums `SubscriptionEventKind`, `SubscriptionEventActor`; table `subscription_events` as in the design; `details` a JSON object, default `{}`; `occurred_at` default now(); index on (`organization_id`, `occurred_at`).
- Checks (23514): `person_id` set exactly when `actor` is OWNER; `administrator_id` and `admin_action_id` set exactly when `actor` is ADMINISTRATOR; `payment_id` set when `actor` is PAYER; `details` is a JSON object.
- GRANT SELECT and INSERT only (C-39). `prisma/schema.prisma`: enums, model and a plain-words `//` comment above it (append only, each actor carries its own reference, migration).
- `SubscriptionEvent:required`: NOT NULL: `organization_id`, `kind`, `actor`, `details`, `occurred_at`
- `SubscriptionEvent.kind:enum`: one of PAYMENT, FORFAIT_ADDED, FORFAIT_ENDED, PLAN_CHANGED, REMINDER, KEEP_CHOICE, PAUSED, RESUMED
- `SubscriptionEvent.actor:enum`: one of PAYER, OWNER, SYSTEM, ADMINISTRATOR
- `SubscriptionEvent:fk`: references organization_id → Organization; person_id → Person; administrator_id → Administrator; admin_action_id → AdminAction; subscription_id → Subscription; payment_id → SubscriptionPayment
- `C-55`: `SubscriptionEvent`: `person_id` is set exactly when `actor = OWNER`; `administrator_id` and `admin_action_id` are set exactly when `actor = ADMINISTRATOR`; `payment_id` is set when `actor = PAYER`; no update, no delete.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Events
  When an event with kind <kind> and actor <actor> and <links> is inserted
  Then it is stored
  Examples:
    | kind          | actor         | links                                |
    | PAYMENT       | PAYER         | a payment                            |
    | KEEP_CHOICE   | OWNER         | a person                             |
    | PLAN_CHANGED  | ADMINISTRATOR | an administrator and an admin action |
    | REMINDER      | SYSTEM        | no reference                         |
Scenario Outline: AC-2 Wrong rows are refused
  When a row is inserted with <problem>
  Then the database refuses it with <code>
  Examples:
    | problem                                 | code  |
    | actor OWNER and no `person_id`          | 23514 |
    | actor SYSTEM and a `person_id`          | 23514 |
    | actor ADMINISTRATOR without an action   | 23514 |
    | actor PAYER and no `payment_id`         | 23514 |
    | `details` set to a list                 | 23514 |
    | kind `REFUND`                           | 22P02 |
Scenario: AC-3 Never changed or deleted
  When the application account updates, deletes or truncates
  Then each statement fails with 42501
```

## Abuse cases
```gherkin
Scenario: AB-1 The history of a plan is rewritten (tampering, T8)
  When the application account updates `kind` or `details` of a stored event
  Then the statement fails with 42501 and the row is unchanged
```

## Implementation
- Create: `prisma/migrations/<timestamp>_bil_004_subscription_events/migration.sql`, `tests/integration/billing/subscription-events-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the database keeps the journal append-only and ties each event to its actor.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| events | integration | AC-1, SubscriptionEvent:required, SubscriptionEvent.kind:enum, SubscriptionEvent.actor:enum, SubscriptionEvent:fk | each Examples row → stored |
| wrong rows | integration | AC-2, C-55 | each Examples row → the code |
| immutable | integration | AC-3, C-39 | UPDATE, DELETE, TRUNCATE → 42501 |
| rewrite | security | AB-1, CWE-345 | UPDATE kind and details → 42501 |

Command: `npx vitest run tests/integration/billing/subscription-events-table.test.ts`

## Out of scope
- Writing events: the stories that cause them (BIL-014, BIL-018, BIL-019, BIL-023).
