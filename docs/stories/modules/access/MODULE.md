# Module Access (`access`)

Owns the rules table, the role order, the CASL ability builder, the ability middleware and the idempotency of online gestures.

- Story prefix: `ACC` · ASVS L2: Every module trusts this one for authorization decisions; the rules refuse by default and a table of tests covers every role and situation.
- Depends on: `foundation`, `person`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- None (technical module).

## Data classification
| data | class | handling |
|---|---|---|
| IdempotencyKey.response_body | confidential | stored 30 days, never logged |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | E | A lower role reaches a higher role's action | rules table, `atLeast` refuses unknown roles, table tests | ACC-001 AB-1, ACC-006 AB-1 |
| T2 | E | A manager power is used offline with a stale role | those rules are ONLINE or NETWORK only | ACC-002 AB-1, ACC-005 AB-1 |
| T3 | T | A gesture sent twice counts twice | idempotency key per person and gesture id | ACC-007 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
