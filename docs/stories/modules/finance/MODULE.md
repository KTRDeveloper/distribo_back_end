# Module Finance (`finance`)

Owns the ledger of each relationship, the balance and held-money caches, expenses, handovers, the nightly check and the owner's money exceptions.

- Story prefix: `FIN` · ASVS L2: Money is recorded here; entries are immutable and the caches are updated atomically, but only managers and the owner may move money beyond a collection.
- Depends on: `foundation`, `person`, `notification`, `access`, `organization`, `relationship`, `order`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `LedgerEntry` (design `finances/ledgerentry`)
- `Expense` (design `finances/expense`)
- `Handover` (design `finances/handover`)

## Data classification
| data | class | handling |
|---|---|---|
| LedgerEntry.amount, balance_effect | confidential | visible to both parties of the relationship |
| LedgerEntry.recorded_by_id | internal | supplier team only |
| Expense, Handover | confidential | organization team; the customer never sees them |
| Collaboration.amount_held | confidential | the collaborator and the owner |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | T | A ledger entry is edited or deleted | the application role has INSERT and SELECT only | FIN-001 AB-1 |
| T2 | T | A lost response makes a refund happen twice | client-created ids and the idempotency middleware | FIN-005 AB-1 |
| T3 | E | A seller or driver refunds, credits or reverses | those gestures need MANAGER online or OWNER | FIN-005 AB-2, FIN-009 AB-1 |
| T4 | T | Two simultaneous writes lose one effect on a balance | caches change by addition in a fixed order | FIN-003 AB-1 |
| T5 | R | Money leaves without the owner noticing | money gestures by non-owners are grouped by person for the owner | FIN-019 AB-1 |
| T6 | T | The recorder of a handover keeps part of the cash | the remitter is told the amount noted and can dispute it | FIN-016 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
