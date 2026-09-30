# Module Order (`order`)

Owns orders and their lines, the order state machine, and the gestures that place, accept, refuse, enter, change and cancel orders before delivery.

- Story prefix: `ORD` · ASVS L2: Orders fix prices and totals that become debts; the server computes every price and total and enforces the state machine.
- Depends on: `foundation`, `person`, `notification`, `access`, `organization`, `relationship`, `catalog`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `Order` (design `commandes-et-livraisons/order`)
- `OrderLine` (design `commandes-et-livraisons/orderline`)

## Data classification
| data | class | handling |
|---|---|---|
| OrderLine.unit_price_applied, reference_price, amount | confidential | visible to both parties of the relationship |
| OrderLine.price_set_by_id | internal | visible to the supplier's owner and managers only |
| Order.customer_note, supplier_note | confidential | visible to both parties |
| Order.sync_issue | internal | supplier team only |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | T | A client chooses its own price | the server computes the reference price and applies it; the customer never sends a price | ORD-009 AB-1 |
| T2 | T | A supplier raises a price after the customer's order | acceptance may only lower a price; prices freeze at acceptance | ORD-011 AB-1 |
| T3 | T | A step is skipped or a frozen order is changed | one state machine with conditional updates | ORD-008 AB-1, ORD-014 AB-1 |
| T4 | E | A driver or seller does a manager's or customer's step | rules table per step | ORD-011 AB-2, ORD-016 AB-1 |
| T5 | I | A party reads another business's orders | visibility predicate through the relationship | ORD-019 AB-1 |
| T6 | R | A price gap has no author | price_set_by_id and price_set_at are required when the applied price differs | ORD-004 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
