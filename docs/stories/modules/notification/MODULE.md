# Module Notification (`notification`)

Stores in-app notifications for registered people and lets them list and mark them as read.

- Story prefix: `NTF` · ASVS L2: Notifications carry business events and names about a person's own account and are private to the recipient.
- Depends on: `foundation`, `person`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `Notification` (design `notifications/notification`)

## Data classification
| data | class | handling |
|---|---|---|
| Notification.content | PII | visible to the recipient only; may name customers and amounts; never logged |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | I | A person reads another person's notifications | every query filters on the recipient id from the session | NTF-003 AB-1, NTF-004 AB-1 |
| T2 | T | A client marks or creates notifications for others | no create route; read state changes only on own rows | NTF-004 AB-2 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
