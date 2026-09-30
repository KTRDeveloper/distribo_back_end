# Module Synchronization (`sync`)

Owns the WatermelonDB pull and push endpoints, the judging of every pushed line, the archive of received batches, full resynchronization and replay.

- Story prefix: `SYNC` · ASVS L2: A phone can be modified; the server judges every pushed line for scope, fields, steps and controls, and never trusts a computed value or a date from the phone.
- Depends on: `foundation`, `person`, `notification`, `access`, `auth`, `organization`, `relationship`, `catalog`, `order`, `finance`, `delivery`, `admin`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `SyncArchive` (design `synchronisation-hors-ligne/syncarchive`)

## Data classification
| data | class | handling |
|---|---|---|
| SyncArchive.changes | confidential | full pushed batches, administrators only, kept 90 days |
| Pull responses | confidential | each phone receives only what its user may see; a driver receives available credit instead of balance and limit |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | E | A phone writes rows of another organization | every pushed row is checked against the viewer's scope | SYNC-010 AB-1 |
| T2 | T | A phone writes fields it may not, or computed fields | field rights by role, computed fields ignored | SYNC-010 AB-2 |
| T3 | T | A phone sends a lower sale or a forged balance | sale amount, totals and balances are recomputed by the server | SYNC-014 AB-1 |
| T4 | I | A driver's phone receives customer debts | pull projects available credit only | SYNC-004 AB-1 |
| T5 | E | A revoked collaborator keeps writing | the first push after a rights change is judged with current rights | SYNC-019 AB-1 |
| T6 | D | One duplicate blocks a phone forever | duplicates are merged or stored closed and unknown rows are set aside | SYNC-009 AB-1, SYNC-011 AB-1 |
| T7 | E | A replay runs with an administrator's rights | replay is judged as its author with current rights | SYNC-023 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
