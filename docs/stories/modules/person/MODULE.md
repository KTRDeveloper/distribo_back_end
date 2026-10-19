# Module Person (`person`)

Owns the single identity record of every person (registered or guest), its profile photo key, its phone-number history, the public view organizations get of a person and the registry of handlers called when a phone number is released.

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
| Person.avatar_key | public | the profile photo is shown with the name to anyone who enters the person's number and to the businesses in relation with the person; returned as an address (`avatar_url`), never as a key; written by the server only; empty for a guest and after anonymization |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | I | An organization reads private fields of a person | closed-list projection `toPublicPerson` used for every organization-facing response | PER-005 AB-1, PER-006 AB-1 |
| T2 | I | Someone enumerates registered names by number | per-person lookup limit, guests and released numbers look alike | PER-006 AB-2 |
| T3 | T | A client writes another person's profile or server-owned fields | strict schema, person id from the session | PER-007 AB-1, AB-2 |
| T4 | R | A phone number change leaves no trace | immutable PhoneNumberChangeLog | PER-004 AB-1 |
| T5 | I | A guest or an anonymized person keeps a profile photo, or two people share one file | database checks and a unique key | PER-010 AB-1 |
| T6 | T | A client writes a photo key into a profile | the profile schema is strict and the key is written by the server only | PER-012 AB-1, PER-013 AB-1 |
| T7 | T | A number changes holder and nothing follows | every release of a number calls the registered handlers in the same transaction, and a failing handler aborts the release | PER-014 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
