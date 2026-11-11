# Story map

- Design: `data-model/conception.md` · sha256 `9b9acc0c417cd1121574a7800bf412490868f69018a139fb5dfaefef8850df66` · commit `none (design not committed)`
- Included: `data-model/modele-donnees-livraisons-v16.md` · sha256 `df1d3ad500d8cb837941bafc4c5ca1682ad30c01163efa80a26092c967a18cbb` · commit `072604f3409f9f9b60af1d24eee4bde33f27aac5`
- Included: `data-model/modele-donnees-livraisons-v16-addendum.md` · sha256 `126de33ab4b7778a1569d289a67a55c2125d9dd3d8d3f63628f7646328b62678` · commit `none`
- Template version: 1.4.0 · Stories folder: `docs/stories`
- Stories: 422 (todo 29, in_progress 0, blocked 0, done 393, obsolete 0)

## Modules
| module | prefix | owned entities | todo | in_progress | blocked | done | obsolete | next free ID | ASVS |
|---|---|---|---|---|---|---|---|---|---|
| foundation | FND | — | 0 | 0 | 0 | 15 | 0 | FND-015 | L2 |
| person | PER | Person, PhoneNumberChangeLog | 0 | 0 | 0 | 14 | 0 | PER-015 | L2 |
| access | ACC | — | 0 | 0 | 0 | 8 | 0 | ACC-009 | L2 |
| notification | NTF | Notification | 1 | 0 | 0 | 4 | 0 | NTF-006 | L2 |
| auth | AUTH | OtpChallenge, Device, RefreshToken | 6 | 0 | 0 | 38 | 0 | AUTH-045 | L2 |
| admin | ADM | Report, Administrator, AdminAction | 0 | 0 | 0 | 20 | 0 | ADM-021 | L2 |
| billing | BIL | Subscription, SubscriptionPayment, SubscriptionReceipt, SubscriptionEvent | 0 | 0 | 0 | 39 | 0 | BIL-040 | L2 |
| catalog | CAT | Product, ProductVariant, CustomerPrice | 0 | 0 | 0 | 46 | 0 | CAT-047 | L2 |
| delivery | DLV | Delivery | 3 | 0 | 0 | 16 | 0 | DLV-020 | L2 |
| finance | FIN | LedgerEntry, Expense, Handover | 0 | 0 | 0 | 22 | 0 | FIN-023 | L2 |
| images | IMG | ImageCopy | 0 | 0 | 0 | 12 | 0 | IMG-013 | L2 |
| order | ORD | Order, OrderLine | 11 | 0 | 0 | 34 | 0 | ORD-046 | L2 |
| organization | ORG | Organization, Collaboration, OrganizationContact | 0 | 0 | 0 | 45 | 0 | ORG-046 | L2 |
| privacy | PRIV | — | 1 | 0 | 0 | 5 | 0 | PRIV-007 | L2 |
| relationship | REL | CustomerRelationship, CustomerRelationshipReassignment, CreditLimitChange | 2 | 0 | 0 | 31 | 0 | REL-034 | L2 |
| sync | SYNC | SyncArchive | 5 | 0 | 0 | 44 | 0 | SYNC-050 | L2 |

## Next implementable
1. NTF-005: Notifications about one entity can be pointed at its replacement (`modules/notification/NTF-005-notifications-about-one-entity-can-be-pointed.md`, risk low)
2. AUTH-039: A device stores the fingerprint of its Android id (`modules/auth/AUTH-039-a-device-stores-the-fingerprint-of-its-android.md`, risk high)
3. AUTH-043: A lock refusal can tell the time left (`modules/auth/AUTH-043-a-lock-refusal-can-tell-the-time-left.md`, risk medium)
4. ORD-038: An order is refused when its total changed since the customer saw it (`modules/order/ORD-038-an-order-is-refused-when-its-total-changed.md`, risk medium)
5. DLV-017: A delivery paid in full is accepted even when the credit limit is already exceeded (`modules/delivery/DLV-017-a-delivery-paid-in-full-is-accepted-even-when.md`, risk medium)

## Pending changes
None.
