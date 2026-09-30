# Module Delivery (`delivery`)

Owns delivery attempts by drivers and the single "Commande livrée" gesture that closes an order, records the sale and the payment, checks the credit limit and handles partial deliveries and counter sales.

- Story prefix: `DLV` · ASVS L2: Delivery moves goods and cash; the server fixes the sale amount, checks credit and keeps the driver's writes to the two entries born of delivery.
- Depends on: `foundation`, `person`, `notification`, `access`, `organization`, `relationship`, `order`, `finance`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `Delivery` (design `commandes-et-livraisons/delivery`)

## Data classification
| data | class | handling |
|---|---|---|
| Delivery.failure_reason | internal | supplier team only |
| Driver views | confidential | a driver sees the available credit of a customer, never balance or limit |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | T | A phone sends a lower sale amount than the order total | the server takes the amount from the order | DLV-007 AB-1 |
| T2 | E | A driver refunds, cancels or grants credit | a driver's writes are limited to the sale and payment of a delivery | DLV-007 AB-2 |
| T3 | I | A driver learns a customer's debt | driver views carry only the available credit | DLV-003 AB-1 |
| T4 | T | Two drivers depart with one order | one in-progress delivery per order | DLV-005 AB-1 |
| T5 | T | Credit is exceeded by a delivery | the credit rule is checked in the same transaction under a row lock | DLV-007 AB-3 |
| T6 | R | Goods leave without the owner knowing | abandoned rests and unsettled deliveries are shown to the owner | DLV-011 AB-1, DLV-012 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
