# Story map

- Design: `data-model/modele-donnees-livraisons-v16.md` · sha256 `035497ce5c79ed3b17c5b0bf41b90fddbedc0250ef16a70d20a72d7ba7d626c2` · commit `3901c64eca51d3374d626ee5f7ecbcbdf1a85992`
- Template version: 1.3.1 · Stories folder: `docs/stories`
- Stories: 387 (todo 179, in_progress 0, blocked 0, done 208, obsolete 0)

## Modules
| module | prefix | owned entities | todo | in_progress | blocked | done | obsolete | next free ID | ASVS |
|---|---|---|---|---|---|---|---|---|---|
| foundation | FND | — | 2 | 0 | 0 | 13 | 0 | FND-015 | L2 |
| person | PER | Person, PhoneNumberChangeLog | 5 | 0 | 0 | 9 | 0 | PER-015 | L2 |
| access | ACC | — | 1 | 0 | 0 | 7 | 0 | ACC-009 | L2 |
| notification | NTF | Notification | 0 | 0 | 0 | 4 | 0 | NTF-005 | L2 |
| auth | AUTH | OtpChallenge, Device, RefreshToken | 12 | 0 | 0 | 26 | 0 | AUTH-039 | L2 |
| admin | ADM | Report, Administrator, AdminAction | 5 | 0 | 0 | 15 | 0 | ADM-021 | L2 |
| billing | BIL | Subscription, SubscriptionPayment, SubscriptionReceipt, SubscriptionEvent | 39 | 0 | 0 | 0 | 0 | BIL-040 | L2 |
| catalog | CAT | Product, ProductVariant, CustomerPrice | 35 | 0 | 0 | 11 | 0 | CAT-047 | L2 |
| delivery | DLV | Delivery | 4 | 0 | 0 | 12 | 0 | DLV-017 | L2 |
| finance | FIN | LedgerEntry, Expense, Handover | 2 | 0 | 0 | 20 | 0 | FIN-023 | L2 |
| images | IMG | ImageCopy | 12 | 0 | 0 | 0 | 0 | IMG-013 | L2 |
| order | ORD | Order, OrderLine | 13 | 0 | 0 | 21 | 0 | ORD-035 | L2 |
| organization | ORG | Organization, Collaboration, OrganizationContact | 26 | 0 | 0 | 19 | 0 | ORG-046 | L2 |
| relationship | REL | CustomerRelationship, CustomerRelationshipReassignment, CreditLimitChange | 1 | 0 | 0 | 25 | 0 | REL-027 | L2 |
| sync | SYNC | SyncArchive | 20 | 0 | 0 | 23 | 0 | SYNC-044 | L2 |
| privacy | PRIV | — | 2 | 0 | 0 | 3 | 0 | PRIV-006 | L2 |

## Next implementable
1. FND-013: Image keys and public image addresses (`modules/foundation/FND-013-image-keys-and-public-image-addresses.md`, risk medium)
2. FND-014: Plan grid and business payment codes (`modules/foundation/FND-014-plan-grid-and-business-payment-codes.md`, risk medium)
3. PER-010: Profile photo key on the person (`modules/person/PER-010-profile-photo-key-on-the-person.md`, risk high)
4. PER-014: Handlers called when a phone number is released (`modules/person/PER-014-handlers-called-when-a-phone-number-is-released.md`, risk medium)
5. ACC-008: Availability values say who may act offline (`modules/access/ACC-008-availability-values-say-who-may-act-offline.md`, risk high)

## Pending changes
None.
