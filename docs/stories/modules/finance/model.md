# Model: finance

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## LedgerEntry
Design: `finances/ledgerentry`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| customer_relationship_id | FK → CustomerRelationship | LedgerEntry:fk |
| order_id | FK → Order, nullable | LedgerEntry:fk, C-24 |
| kind | enum [SALE / PAYMENT / REFUND / CREDIT_NOTE / OPENING_BALANCE] | LedgerEntry.kind:enum, C-23, C-24, CM-21 |
| amount | bigint | C-23, C-24, CM-13 |
| balance_effect | bigint, calculé par la base | LedgerEntry.balance_effect:generated, C-23 |
| mode | enum [CASH / MOBILE_MONEY], nullable | LedgerEntry.mode:enum, C-23 |
| transaction_reference | string, nullable |  |
| reverses_entry_id | FK → LedgerEntry, nullable | LedgerEntry:fk, C-23, C-25 |
| recorded_by_id | FK → Person | LedgerEntry:fk |
| note | text, nullable |  |
| occurred_at | datetime |  |

- `LedgerEntry:required`: NOT NULL: `customer_relationship_id`, `kind`, `amount`, `recorded_by_id`, `occurred_at`
- `LedgerEntry.kind:enum`: one of SALE, PAYMENT, REFUND, CREDIT_NOTE, OPENING_BALANCE
- `LedgerEntry.mode:enum`: one of CASH, MOBILE_MONEY
- `LedgerEntry:fk`: references customer_relationship_id → CustomerRelationship; order_id → Order; reverses_entry_id → LedgerEntry; recorded_by_id → Person
- `LedgerEntry.balance_effect:generated`: computed by the database; never written by the application
- `C-23`: `LedgerEntry.amount` > 0; `balance_effect` is a generated column of `kind`, `amount` and `reverses_entry_id`; `mode` is set if and only if `kind` is PAYMENT or REFUND.
- `C-24`: A SALE entry has `order_id` set and `amount` equal to `Order.total_amount` (server-fixed), and there is at most one non-reversed sale per order; the payment born of 'Commande livrée' also carries `order_id`.
- `C-25`: A ledger entry is never updated or deleted; `reverses_entry_id` is unique, on the same relationship, the same kind and amount, and points to an entry that is not itself a reversal.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.
- `CM-13`: The amount of a sale is always Order.total_amount computed by the server on delivered quantities; the amount sent by the phone is ignored.
- `CM-21`: A returned-and-refunded gesture records a CREDIT_NOTE and a REFUND of the same amount in one transaction.

## Expense
Design: `finances/expense`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| organization_id | FK → Organization | Expense:fk |
| paid_by_id | FK → Person | Expense:fk, C-27 |
| amount | bigint | C-27 |
| category | string, nullable |  |
| description | text, nullable |  |
| recorded_by_id | FK → Person | Expense:fk |
| occurred_at | datetime |  |
| cancelled_at | datetime, nullable |  |
| cancelled_by_id | FK → Person, nullable | Expense:fk |

- `Expense:required`: NOT NULL: `organization_id`, `paid_by_id`, `amount`, `recorded_by_id`, `occurred_at`
- `Expense:fk`: references organization_id → Organization; paid_by_id → Person; recorded_by_id → Person; cancelled_by_id → Person
- `C-27`: `Expense.amount` > 0 and `paid_by_id` is a collaborator of the organization, active or gone; `Handover.amount` > 0, `from_person_id` a collaborator active or gone, `from_person_id` differs from `to_person_id` except the former owner's automatic handover, `to_person_id` an ACTIVE OWNER or MANAGER; expenses and handovers are never modified, only cancelled once with `cancelled_at` and `cancelled_by_id` set together.

## Handover
Design: `finances/handover`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| organization_id | FK → Organization | Handover:fk |
| from_person_id | FK → Person | Handover:fk, C-27 |
| to_person_id | FK → Person | Handover:fk, C-04, C-27 |
| amount | bigint | C-27, CM-18 |
| occurred_at | datetime |  |
| cancelled_at | datetime, nullable | C-27 |
| cancelled_by_id | FK → Person, nullable | Handover:fk, C-27 |

- `Handover:required`: NOT NULL: `organization_id`, `from_person_id`, `to_person_id`, `amount`, `occurred_at`
- `Handover:fk`: references organization_id → Organization; from_person_id → Person; to_person_id → Person; cancelled_by_id → Person
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-27`: `Expense.amount` > 0 and `paid_by_id` is a collaborator of the organization, active or gone; `Handover.amount` > 0, `from_person_id` a collaborator active or gone, `from_person_id` differs from `to_person_id` except the former owner's automatic handover, `to_person_id` an ACTIVE OWNER or MANAGER; expenses and handovers are never modified, only cancelled once with `cancelled_at` and `cancelled_by_id` set together.
- `CM-18`: At ownership transfer the server records a handover from the former owner to themselves for their amount_held, so it restarts at 0.
