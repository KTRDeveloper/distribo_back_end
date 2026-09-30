# Module Relationship (`relationship`)

Owns the account between one supplier and one customer, counters, credit limits, invitations, contestation and number correction, and the visibility rule between the two parties.

- Story prefix: `REL` · ASVS L2: A relationship carries a debt between two parties; every read and write must respect which party the caller is, and credit decisions are the riskiest gesture of the product.
- Depends on: `foundation`, `person`, `notification`, `access`, `auth`, `organization`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `CustomerRelationship` (design `relations-commerciales/customerrelationship`)
- `CustomerRelationshipReassignment` (design `relations-commerciales/customerrelationshipreassignment`)
- `CreditLimitChange` (design `relations-commerciales/creditlimitchange`)

## Data classification
| data | class | handling |
|---|---|---|
| CustomerRelationship.balance, credit_limit | confidential | supplier and customer parties only; a driver receives only the available credit |
| CustomerRelationship.customer_label, supplier_notes | confidential | supplier party only |
| CustomerRelationship.supplier_label | confidential | customer party only |
| CustomerRelationship.customer_phone_number | PII | supplier party only until the server resolves the person |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | I | An organization sees relationships it is not a party to | one visibility predicate on every read and write | REL-005 AB-1, REL-008 AB-1 |
| T2 | I | A party reads the other party's private fields | per-party projections with explicit field lists | REL-005 AB-2, REL-016 AB-2 |
| T3 | E | A seller or driver grants credit, or a manager grants it to themselves | credit needs OWNER or online MANAGER, never on one's own record | REL-012 AB-1, AB-2 |
| T4 | T | A debt moves to another debtor | reassignment only by correction or contestation, journaled and immutable, never to a person with a relation already | REL-023 AB-1, REL-024 AB-1 |
| T5 | R | A credit limit changes without a trace | every change writes the immutable journal in the same transaction | REL-004 AB-1 |
| T6 | S | Guessing numbers to learn who is registered | lookup and invitation limits | REL-020 AB-2 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
