# Module Administration (`admin`)

Owns platform administrators with two-factor login, reports from users, suspensions and reactivations, and the immutable journal of administration actions.

- Story prefix: `ADM` · ASVS L2: An administrator can block any business; the account is protected by a password plus TOTP, short sessions, and every action is journaled.
- Depends on: `foundation`, `person`, `notification`, `access`, `organization`, `auth`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `Report` (design `moderation/report`)
- `Administrator` (design `gouvernance-de-la-plateforme/administrator`)
- `AdminAction` (design `gouvernance-de-la-plateforme/adminaction`)

## Data classification
| data | class | handling |
|---|---|---|
| Administrator.totp_secret | credential | AES-256-GCM encrypted, never returned after enrolment, never logged |
| Administrator.recovery_email | PII | shown only to that administrator |
| AdminAction.reason | confidential | administrators only |
| Report.description | PII | reporter and administrators only |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | S | An administrator account is taken with a password only | TOTP is mandatory at every admin login and a code cannot be reused | ADM-006 AB-1 |
| T2 | E | A normal session or token reaches admin routes | admin routes accept only an admin-typed token of a live administrator | ADM-006 AB-2 |
| T3 | E | The recovery path becomes a back door | recovery installs a new key only, needs the password and the verified recovery address, and alerts | ADM-008 AB-1 |
| T4 | E | A moderator appoints or removes administrators | only SUPER_ADMIN | ADM-009 AB-1, ADM-010 AB-1 |
| T5 | R | A suspension leaves no trace | every suspension, reactivation and dismissal writes the immutable journal | ADM-013 AB-1, ADM-014 AB-1 |
| T6 | T | The journal is rewritten | the application account cannot update or delete it | ADM-002 AB-1 |
| T7 | E | A moderator frees a number or hands out an account | RELEASE_PHONE and RESTORE_ACCESS need a SUPER_ADMIN, checked by the route and by the database | ADM-017 AB-1, ADM-016 AB-1 |
| T8 | S | Support gives an account to someone who is not its owner | a code to the verified email and a code to the new number are both needed, and an account with no verified email is refused | ADM-020 AB-1, ADM-019 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
