# Module Catalog (`catalog`)

Owns each organization's own catalog at two levels (products and their variants), the negotiated price per customer for one variant, and the reference price an order line freezes.

- Story prefix: `CAT` · ASVS L2: Prices are business data; a customer must never see another customer's negotiated price, and only managers change prices.
- Depends on: `foundation`, `person`, `notification`, `access`, `organization`, `relationship`, `order`, `images`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `Product` (design `catalogue/product`)
- `ProductVariant` (design `catalogue/productvariant`)
- `CustomerPrice` (design `relations-commerciales/customerprice`)

## Data classification
| data | class | handling |
|---|---|---|
| ProductVariant.price | internal | public to anyone who finds the business, as the default price |
| CustomerPrice.price | confidential | visible to the supplier team and to that customer only |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | I | A customer reads another customer's negotiated price | the catalog view builds prices from the caller's own relationship only | CAT-007 AB-1 |
| T2 | E | A seller or driver changes prices or the catalog | product and price gestures need MANAGER online or OWNER | CAT-004 AB-1, CAT-008 AB-1 |
| T3 | E | A manager sets their own negotiated price | own customer record is refused | CAT-008 AB-2 |
| T4 | T | A price is written for a variant of another business | the variant must belong to the relationship's supplier | CAT-008 AB-3, CAT-015 AB-1 |
| T5 | E | A business goes past its product limit by creating products or putting them back on sale | the online routes refuse at the limit (409 PRODUCT_LIMIT_REACHED); what arrives by synchronization is paused afterwards | CAT-022 AC-3, CAT-024 AC-3, CAT-038 AC-2 |
| T6 | T | A deletion erases the article of past sales | a variant cited by an order line or a negotiated price is never deleted, online or by synchronization | CAT-026 AB-1, CAT-036 AB-1 |
| T7 | E | A phone un-pauses a product, writes photo keys or the merge link | the sync writers read named fields only | CAT-033 AB-2, CAT-034 AC-5, CAT-035 AB-2 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
