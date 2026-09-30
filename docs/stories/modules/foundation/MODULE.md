# Module Foundation (`foundation`)

Quality gates, database reset and roles, and the shared kernel (money, phone numbers, identifiers, errors) every other module uses.

- Story prefix: `FND` · ASVS L2: The foundation carries the pipeline, the database roles and the security scans every module depends on; it holds no personal data.
- Depends on: none
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- None (technical module).

## Data classification
| data | class | handling |
|---|---|---|
| Environment variables | credential | validated at startup, never logged |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | T | A dependency or CI step is added without review | allowlist in CONVENTIONS.md, audit, SAST and secret scan in CI | FND-000 AB-1 |
| T2 | E | The application database account can rewrite a journal | separate application role without UPDATE or DELETE on immutable tables | FND-002 AB-1 |
| T3 | I | Query logs print personal data | Prisma logs errors and warnings only | FND-007 AB-1 |
| T4 | D | Oversized JSON bodies exhaust memory | 100 kb default limit | FND-008 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
