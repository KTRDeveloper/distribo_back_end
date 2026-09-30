# Module Privacy (`privacy`)

Owns account deletion by anonymization and the daily purge of data that has reached its retention period.

- Story prefix: `PRIV` · ASVS L2: Personal data must be erased or anonymized when the law and the design say so, without breaking the commercial history of businesses.
- Depends on: `foundation`, `person`, `notification`, `access`, `auth`, `organization`, `relationship`, `order`, `finance`, `sync`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- None (technical module).

## Data classification
| data | class | handling |
|---|---|---|
| Person.* | PII | erased at anonymization except the released number kept for organization history |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | T | Someone deletes another person's account | deletion needs the signed-in person's password | PRIV-002 AB-1 |
| T2 | R | An owner deletes their account leaving a business without an owner | deletion is blocked until every owned business is transferred or closed | PRIV-001 AB-1 |
| T3 | I | Personal data survives deletion | every personal column is erased and sessions and codes removed | PRIV-002 AB-2 |
| T4 | T | The purge deletes commercial history | the purge touches only the tables and periods of the retention table | PRIV-003 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
