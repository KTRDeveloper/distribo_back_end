# Story map

- Design: `data-model/modele-donnees-livraisons-v16.md` · sha256 `035497ce5c79ed3b17c5b0bf41b90fddbedc0250ef16a70d20a72d7ba7d626c2` · commit `3901c64eca51d3374d626ee5f7ecbcbdf1a85992`
- Template version: 1.3.1 · Stories folder: `docs/stories`
- Stories: 387 (todo 61, in_progress 0, blocked 0, done 326, obsolete 0)

## Modules
| module | prefix | owned entities | todo | in_progress | blocked | done | obsolete | next free ID | ASVS |
|---|---|---|---|---|---|---|---|---|---|
| foundation | FND | — | 0 | 0 | 0 | 15 | 0 | FND-015 | L2 |
| person | PER | Person, PhoneNumberChangeLog | 0 | 0 | 0 | 14 | 0 | PER-015 | L2 |
| access | ACC | — | 0 | 0 | 0 | 8 | 0 | ACC-009 | L2 |
| notification | NTF | Notification | 0 | 0 | 0 | 4 | 0 | NTF-005 | L2 |
| auth | AUTH | OtpChallenge, Device, RefreshToken | 0 | 0 | 0 | 38 | 0 | AUTH-039 | L2 |
| admin | ADM | Report, Administrator, AdminAction | 0 | 0 | 0 | 20 | 0 | ADM-021 | L2 |
| billing | BIL | Subscription, SubscriptionPayment, SubscriptionReceipt, SubscriptionEvent | 32 | 0 | 0 | 7 | 0 | BIL-040 | L2 |
| catalog | CAT | Product, ProductVariant, CustomerPrice | 2 | 0 | 0 | 44 | 0 | CAT-047 | L2 |
| delivery | DLV | Delivery | 0 | 0 | 0 | 16 | 0 | DLV-017 | L2 |
| finance | FIN | LedgerEntry, Expense, Handover | 0 | 0 | 0 | 22 | 0 | FIN-023 | L2 |
| images | IMG | ImageCopy | 0 | 0 | 0 | 12 | 0 | IMG-013 | L2 |
| order | ORD | Order, OrderLine | 2 | 0 | 0 | 32 | 0 | ORD-035 | L2 |
| organization | ORG | Organization, Collaboration, OrganizationContact | 3 | 0 | 0 | 42 | 0 | ORG-046 | L2 |
| relationship | REL | CustomerRelationship, CustomerRelationshipReassignment, CreditLimitChange | 0 | 0 | 0 | 26 | 0 | REL-027 | L2 |
| sync | SYNC | SyncArchive | 20 | 0 | 0 | 23 | 0 | SYNC-044 | L2 |
| privacy | PRIV | — | 2 | 0 | 0 | 3 | 0 | PRIV-006 | L2 |

## Next implementable
1. ORG-043: The public-contact flag column and its database rule are dropped (`modules/organization/ORG-043-the-public-contact-flag-column-and-its-database.md`, risk high)
2. SYNC-024: The catalog pull speaks products and variants (`modules/sync/SYNC-024-the-catalog-pull-speaks-products-and-variants.md`, risk medium)
3. SYNC-027: Negotiated prices and order lines are pulled by variant (`modules/sync/SYNC-027-negotiated-prices-and-order-lines-are-pulled-by.md`, risk medium)
4. SYNC-028: Controls on arrival and the list to resolve read the variant (`modules/sync/SYNC-028-controls-on-arrival-and-the-list-to-resolve.md`, risk medium)
5. SYNC-029: An order line entered offline names a variant (`modules/sync/SYNC-029-an-order-line-entered-offline-names-a-variant.md`, risk medium)

## Pending changes
None.
