# Module Billing (`billing`)

Owns paid plans for businesses: the subscription periods, the payment requests made on a website through a mobile-money aggregator, receipts and credit notes, the subscription journal, grace and pause at expiry, reminders, the nightly reconciliation and the administrators' gift, record and refund gestures.

- Story prefix: `BIL` · ASVS L2: The module moves money-like data (payments, receipts) and decides what a business may do; the payer is not signed in, so every claim comes from the aggregator and is checked again, never from the browser. No card data is handled: payment is mobile money through an aggregator.
- Depends on: `foundation`, `person`, `notification`, `access`, `auth`, `organization`, `catalog`, `order`, `delivery`, `admin`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `Subscription` (design `finances/subscription`)
- `SubscriptionPayment` (design `finances/subscriptionpayment`)
- `SubscriptionReceipt` (design `finances/subscriptionreceipt`)
- `SubscriptionEvent` (design `finances/subscriptionevent`)

## Data classification
| data | class | handling |
|---|---|---|
| Subscription.plan, starts_at, ends_at, status, price | confidential | the plan of a business is visible to its team and to administrators only, never to its customers or suppliers, and never synchronized |
| SubscriptionPayment.payer_phone_number | PII | the payer is not always the owner; shown masked in the owner's notification, never logged, never returned to the site |
| SubscriptionPayment.provider_payload, provider_reference | confidential | kept as received for disputes; never returned by any route |
| SubscriptionPayment.customer_tax_id, SubscriptionReceipt.customer_tax_id | confidential | copied on the receipt; returned to the team and to the payer on the confirmation page only |
| SubscriptionReceipt.* | confidential | immutable; readable by the team of the business and by administrators |
| SubscriptionEvent.* | confidential | immutable journal of the plan; readable by administrators; the owner reads only their own subscription screen |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | S | A forged or replayed confirmation activates a plan | a confirmation counts only after its signature is verified by the aggregator port and the aggregator is asked for the payment status again; the browser proves nothing | BIL-034 AB-1, BIL-034 AB-2, BIL-008 AB-1 |
| T2 | T | The browser chooses the amount, the plan or the period | the server computes the amount from its own price grid; the body carries only the code, the plan, the duration, the operator and the number | BIL-009 AB-1 |
| T3 | T | One payment activates two periods, or a receipt number is skipped or repeated | `provider_reference` is unique, a payment moves forward only, and receipt numbers are taken under a lock in the confirming transaction | BIL-014 AB-2, BIL-001 AB-1, BIL-002 AB-1, BIL-011 AB-1, BIL-027 AB-1 |
| T4 | E | An owner or a manager writes the plan of a business without paying | no route writes the subscription tables or the plan fields of the organization; the former owner routes are removed | BIL-005 AB-1 |
| T5 | I | The plan of a business reaches its customers, its suppliers or a stranger | the subscription fields go to the team only and the tables are never synchronized | BIL-015 AB-1 |
| T6 | I | Guessing business payment codes to learn names | the code lookup answers only the name and the start date, is rate limited per IP, and an unknown code is a plain 404 | BIL-007 AB-1, BIL-033 AB-1 |
| T7 | E | A moderator or a manager gifts days, records or refunds a payment | the three gestures need SUPER_ADMIN, a reason and an `AdminAction` row | BIL-023 AB-1, BIL-024 AB-1, BIL-025 AB-1 |
| T8 | R | A dispute about who did what to a plan | `SubscriptionEvent` and `SubscriptionReceipt` are immutable and written in the transaction of the fact | BIL-004 AB-1, BIL-003 AB-1, BIL-003 AB-2, BIL-012 AB-1 |
| T9 | D | Lost confirmations leave payments pending, or a payer is charged and nothing activates | a sweep re-asks the aggregator for old pending payments and a nightly reconciliation compares the statement | BIL-021 AB-1, BIL-022 AB-1 |

## Pointers
- Decision: `docs/stories/decisions/ADR-004-modules-for-design-v16.md`
