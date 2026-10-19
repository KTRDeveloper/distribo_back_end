# Model: billing

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Subscription
Design: `finances/subscription`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| organization_id | FK → Organization | Subscription:fk, C-52 |
| plan | enum [ESSENTIAL / PRO / ENTERPRISE] | Subscription.plan:enum |
| months | int, nullable | C-52 |
| price | bigint |  |
| origin | enum [PAYMENT / CONVERSION / GIFT] | Subscription.origin:enum, C-52 |
| payment_id | FK → SubscriptionPayment, nullable | Subscription:fk, C-52 |
| status | enum [SCHEDULED / ACTIVE / ENDED] | Subscription.status:enum, C-52 |
| end_reason | enum [EXPIRED / UPGRADED / CLOSED / REFUNDED], nullable | Subscription.end_reason:enum, C-52 |
| created_at | datetime |  |

- `Subscription:required`: NOT NULL: `organization_id`, `plan`, `price`, `origin`, `status`, `created_at`
- `Subscription.plan:enum`: one of ESSENTIAL, PRO, ENTERPRISE
- `Subscription.origin:enum`: one of PAYMENT, CONVERSION, GIFT
- `Subscription.status:enum`: one of SCHEDULED, ACTIVE, ENDED
- `Subscription.end_reason:enum`: one of EXPIRED, UPGRADED, CLOSED, REFUNDED
- `Subscription:fk`: references organization_id → Organization; payment_id → SubscriptionPayment
- `C-52`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); periods of one organization never overlap (exclusion constraint); `starts_at` is not after `ends_at`; `payment_id` and `months` are set exactly when `origin = PAYMENT`; `end_reason` is set exactly when `status = ENDED`; only the server writes it.

## SubscriptionPayment
Design: `finances/subscriptionpayment`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| organization_id | FK → Organization | SubscriptionPayment:fk |
| plan | enum [ESSENTIAL / PRO / ENTERPRISE] | SubscriptionPayment.plan:enum |
| months | int | C-53 |
| amount | bigint | C-53 |
| operator | enum [MTN_MOMO / ORANGE_MONEY / OTHER] | SubscriptionPayment.operator:enum, C-53 |
| payer_phone_number | string, nullable | C-53 |
| provider_reference | string, unique | SubscriptionPayment.provider_reference:unique, C-53 |
| status | enum [PENDING / SUCCEEDED / FAILED / EXPIRED / REFUNDED] | SubscriptionPayment.status:enum, C-53 |
| provider_payload | JSON, nullable |  |
| terms_version | string |  |
| customer_tax_id | string, nullable |  |
| created_at | datetime |  |
| confirmed_at | datetime, nullable | C-53 |

- `SubscriptionPayment:required`: NOT NULL: `organization_id`, `plan`, `months`, `amount`, `operator`, `provider_reference`, `status`, `terms_version`, `created_at`
- `SubscriptionPayment.provider_reference:unique`: unique
- `SubscriptionPayment.plan:enum`: one of ESSENTIAL, PRO, ENTERPRISE
- `SubscriptionPayment.operator:enum`: one of MTN_MOMO, ORANGE_MONEY, OTHER
- `SubscriptionPayment.status:enum`: one of PENDING, SUCCEEDED, FAILED, EXPIRED, REFUNDED
- `SubscriptionPayment:fk`: references organization_id → Organization
- `C-53`: `SubscriptionPayment`: `provider_reference` is unique; `months` is 1, 3, 6 or 12; `amount` is computed by the server from the price grid; status moves only from PENDING to another value, then from SUCCEEDED to REFUNDED; `confirmed_at` is set exactly when status is SUCCEEDED or REFUNDED; `operator = OTHER` exactly when an administrator recorded the payment, and `payer_phone_number` is set otherwise.

## SubscriptionReceipt
Design: `finances/subscriptionreceipt`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| number | string, unique | SubscriptionReceipt.number:unique, C-54 |
| kind | enum [RECEIPT / CREDIT_NOTE] | SubscriptionReceipt.kind:enum, C-54 |
| organization_id | FK → Organization | SubscriptionReceipt:fk |
| payment_id | FK → SubscriptionPayment | SubscriptionReceipt:fk |
| cancels_receipt_id | FK → SubscriptionReceipt, nullable | SubscriptionReceipt:fk, C-54 |
| customer_name | string |  |
| customer_tax_id | string, nullable |  |
| label | string |  |
| amount_excl_tax | bigint | C-54 |
| vat_rate_bp | int |  |
| vat_amount | bigint | C-54 |
| amount | bigint | C-54 |
| issued_at | datetime |  |

- `SubscriptionReceipt:required`: NOT NULL: `number`, `kind`, `organization_id`, `payment_id`, `customer_name`, `label`, `amount_excl_tax`, `vat_rate_bp`, `vat_amount`, `amount`, `issued_at`
- `SubscriptionReceipt.number:unique`: unique
- `SubscriptionReceipt.kind:enum`: one of RECEIPT, CREDIT_NOTE
- `SubscriptionReceipt:fk`: references organization_id → Organization; payment_id → SubscriptionPayment; cancels_receipt_id → SubscriptionReceipt
- `C-54`: `SubscriptionReceipt`: `number` is unique and has no gap; `amount = amount_excl_tax + vat_amount`; `cancels_receipt_id` is set exactly when `kind = CREDIT_NOTE`, and a receipt has at most one credit note; no update, no delete.
- `C-39`: `SubscriptionReceipt` and `SubscriptionEvent` are immutable tables: the application account has only INSERT and SELECT.

## SubscriptionEvent
Design: `finances/subscriptionevent`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| organization_id | FK → Organization | SubscriptionEvent:fk |
| kind | enum [PAYMENT / FORFAIT_ADDED / FORFAIT_ENDED / PLAN_CHANGED / REMINDER / KEEP_CHOICE / PAUSED / RESUMED] | SubscriptionEvent.kind:enum |
| actor | enum [PAYER / OWNER / SYSTEM / ADMINISTRATOR] | SubscriptionEvent.actor:enum, C-55 |
| person_id | FK → Person, nullable | SubscriptionEvent:fk, C-55 |
| administrator_id | FK → Administrator, nullable | SubscriptionEvent:fk, C-55 |
| admin_action_id | FK → AdminAction, nullable | SubscriptionEvent:fk, C-55 |
| subscription_id | FK → Subscription, nullable | SubscriptionEvent:fk |
| payment_id | FK → SubscriptionPayment, nullable | SubscriptionEvent:fk, C-55 |
| details | JSON |  |
| occurred_at | datetime |  |

- `SubscriptionEvent:required`: NOT NULL: `organization_id`, `kind`, `actor`, `details`, `occurred_at`
- `SubscriptionEvent.kind:enum`: one of PAYMENT, FORFAIT_ADDED, FORFAIT_ENDED, PLAN_CHANGED, REMINDER, KEEP_CHOICE, PAUSED, RESUMED
- `SubscriptionEvent.actor:enum`: one of PAYER, OWNER, SYSTEM, ADMINISTRATOR
- `SubscriptionEvent:fk`: references organization_id → Organization; person_id → Person; administrator_id → Administrator; admin_action_id → AdminAction; subscription_id → Subscription; payment_id → SubscriptionPayment
- `C-55`: `SubscriptionEvent`: `person_id` is set exactly when `actor = OWNER`; `administrator_id` and `admin_action_id` are set exactly when `actor = ADMINISTRATOR`; `payment_id` is set when `actor = PAYER`; no update, no delete.
- `C-39`: `SubscriptionReceipt` and `SubscriptionEvent` are immutable tables: the application account has only INSERT and SELECT.
