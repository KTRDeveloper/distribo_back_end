# Story map

- Design: `data-model/modele-donnees-livraisons-v10.md` · sha256 `2dcaae02b638d95d5c9ad80329d53e10d098fec20f5cf5b12182af8f4d03dfd2` · commit `24c54647bb5124266d2709a6f5ac7ea8ff4fc8b9`
- Template version: 1.3.0 · Stories folder: `docs/stories`
- Stories: 208 (todo 154, in_progress 0, blocked 0, done 54, obsolete 0)

## Modules
| module | prefix | owned entities | todo | in_progress | blocked | done | obsolete | next free ID | ASVS |
|---|---|---|---|---|---|---|---|---|---|
| foundation | FND | — | 1 | 0 | 0 | 12 | 0 | FND-013 | L2 |
| person | PER | Person, PhoneNumberChangeLog | 0 | 0 | 0 | 9 | 0 | PER-010 | L2 |
| access | ACC | — | 0 | 0 | 0 | 7 | 0 | ACC-008 | L2 |
| notification | NTF | Notification | 0 | 0 | 0 | 4 | 0 | NTF-005 | L2 |
| auth | AUTH | OtpChallenge, Device, RefreshToken | 4 | 0 | 0 | 22 | 0 | AUTH-027 | L2 |
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
1. FND-012: Validation errors without input values (`modules/foundation/FND-012-validation-errors-without-input-values.md`, risk medium)
2. AUTH-015: Person whose number was taken signs in with the verified email (`modules/auth/AUTH-015-person-whose-number-was-taken-signs-in-with-the.md`, risk high)
3. AUTH-018: Person manages their phones (`modules/auth/AUTH-018-person-manages-their-phones.md`, risk medium)
4. AUTH-020: Person chooses a new password with the code (`modules/auth/AUTH-020-person-chooses-a-new-password-with-the-code.md`, risk high)
5. ORG-001: Organizations table (`modules/organization/ORG-001-organizations-table.md`, risk low)

## Pending changes
None.
