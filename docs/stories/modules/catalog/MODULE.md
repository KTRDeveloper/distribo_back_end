# Module Catalog (`catalog`)

Owns each organization's own articles, the negotiated price per customer, and the reference price an order line freezes.

- Story prefix: `CAT` · ASVS L2: Prices are business data; a customer must never see another customer's negotiated price, and only managers change prices.
- Depends on: `foundation`, `person`, `notification`, `access`, `organization`, `relationship`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `Product` (design `catalogue/product`)
- `CustomerPrice` (design `relations-commerciales/customerprice`)

## Data classification
| data | class | handling |
|---|---|---|
| Product.price | internal | public to anyone who finds the business, as the default price |
| CustomerPrice.price | confidential | visible to the supplier team and to that customer only |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | I | A customer reads another customer's negotiated price | the catalog view builds prices from the caller's own relationship only | CAT-007 AB-1 |
| T2 | E | A seller or driver changes prices or the catalog | product and price gestures need MANAGER online or OWNER | CAT-004 AB-1, CAT-008 AB-1 |
| T3 | E | A manager sets their own negotiated price | own customer record is refused | CAT-008 AB-2 |
| T4 | T | A price is written for a product of another business | the product must belong to the relationship's supplier | CAT-008 AB-3 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
