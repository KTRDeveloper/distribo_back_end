# Module Person (`person`)

Owns the single identity record of every person (registered or guest), its phone-number history and the public view organizations get of a person.

- Story prefix: `PER` · ASVS L2: Personal data (name, phone number, email) and credentials; every other module points to Person.
- Depends on: `foundation`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `Person` (design `identite-et-organisation/person`)
- `PhoneNumberChangeLog` (design `identite-et-organisation/phonenumberchangelog`)

## Data classification
| data | class | handling |
|---|---|---|
| Person.phone_number | PII | public to organizations only as a closed list; never logged |
| Person.released_phone_number | PII | kept for organization history; never returned to other people |
| Person.email | PII | private; never returned to an organization |
| Person.password_hash | credential | never returned, never logged |
| Person.full_name | PII | public name, written only by the person |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | I | An organization reads private fields of a person | closed-list projection `toPublicPerson` used for every organization-facing response | PER-005 AB-1, PER-006 AB-1 |
| T2 | I | Someone enumerates registered names by number | per-person lookup limit, guests and released numbers look alike | PER-006 AB-2 |
| T3 | T | A client writes another person's profile or server-owned fields | strict schema, person id from the session | PER-007 AB-1, AB-2 |
| T4 | R | A phone number change leaves no trace | immutable PhoneNumberChangeLog | PER-004 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
