# Module Organization (`organization`)

Owns businesses, their team with fixed roles and ownership, closing, public contact numbers and the subscription history.

- Story prefix: `ORG` · ASVS L2: Roles decide who can move money and change rights; team, ownership and closing gestures change other people's access.
- Depends on: `foundation`, `person`, `notification`, `access`, `auth`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `Organization` (design `identite-et-organisation/organization`)
- `Collaboration` (design `identite-et-organisation/collaboration`)
- `Subscription` (design `finances/subscription`)

## Data classification
| data | class | handling |
|---|---|---|
| Organization.name, description, email | public | visible to anyone who finds the business |
| Collaboration.amount_held | confidential | visible to the collaborator and the owner |
| Collaboration.role | internal | visible to the team |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | E | A member of one business acts in another | every organization route loads the actor from an ACTIVE collaboration of that organization, else 404 | ORG-005 AB-1 |
| T2 | E | A manager or seller changes the team or the owner | team gestures need OWNER and the network | ORG-007 AB-1, ORG-009 AB-1, ORG-010 AB-1 |
| T3 | E | The owner is demoted, revoked or left with two owners | the database keeps exactly one active OWNER and the routes refuse to touch it | ORG-003 AB-1, ORG-010 AB-2 |
| T4 | S | Someone is found under a number that is not theirs | public contacts are ACTIVE collaborators with a verified active number who agreed | ORG-011 AB-1, ORG-018 AB-1 |
| T5 | I | Enumerating businesses by number | per-person lookup limit shared with person lookups | ORG-018 AB-2 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
