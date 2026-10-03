# Story map

- Design: `data-model/modele-donnees-livraisons-v10.md` · sha256 `2dcaae02b638d95d5c9ad80329d53e10d098fec20f5cf5b12182af8f4d03dfd2` · commit `24c54647bb5124266d2709a6f5ac7ea8ff4fc8b9`
- Template version: 1.2.0 · Stories folder: `docs/stories`
- Stories: 207 (todo 187, in_progress 0, blocked 2, done 18, obsolete 0)

## Modules
| module | prefix | owned entities | todo | in_progress | blocked | done | obsolete | next free ID | ASVS |
|---|---|---|---|---|---|---|---|---|---|
| foundation | FND | — | 0 | 0 | 1 | 11 | 0 | FND-012 | L2 |
| person | PER | Person, PhoneNumberChangeLog | 1 | 0 | 1 | 7 | 0 | PER-010 | L2 |
| access | ACC | — | 7 | 0 | 0 | 0 | 0 | ACC-008 | L2 |
| notification | NTF | Notification | 4 | 0 | 0 | 0 | 0 | NTF-005 | L2 |
| auth | AUTH | OtpChallenge, Device, RefreshToken | 26 | 0 | 0 | 0 | 0 | AUTH-027 | L2 |
| organization | ORG | Organization, Collaboration, Subscription | 19 | 0 | 0 | 0 | 0 | ORG-020 | L2 |
| relationship | REL | CustomerRelationship, CustomerRelationshipReassignment, CreditLimitChange | 25 | 0 | 0 | 0 | 0 | REL-026 | L2 |
| admin | ADM | Report, Administrator, AdminAction | 15 | 0 | 0 | 0 | 0 | ADM-016 | L2 |
| catalog | CAT | Product, CustomerPrice | 11 | 0 | 0 | 0 | 0 | CAT-012 | L2 |
| order | ORD | Order, OrderLine | 21 | 0 | 0 | 0 | 0 | ORD-022 | L2 |
| finance | FIN | LedgerEntry, Expense, Handover | 20 | 0 | 0 | 0 | 0 | FIN-021 | L2 |
| delivery | DLV | Delivery | 12 | 0 | 0 | 0 | 0 | DLV-013 | L2 |
| sync | SYNC | SyncArchive | 23 | 0 | 0 | 0 | 0 | SYNC-024 | L2 |
| privacy | PRIV | — | 3 | 0 | 0 | 0 | 0 | PRIV-004 | L2 |

## Next implementable
1. ACC-001: Role order and ability builder (`modules/access/ACC-001-role-order-and-ability-builder.md`, risk high)
2. AUTH-005: Password rules and Argon2id hashing (`modules/auth/AUTH-005-password-rules-and-argon2id-hashing.md`, risk high)
3. AUTH-006: Access token carries the person and the device (`modules/auth/AUTH-006-access-token-carries-the-person-and-the-device.md`, risk high)

## Pending changes
None.
