# Module Organization (`organization`)

Owns businesses, their team with fixed roles and ownership, closing and reopening, the verified public contacts (numbers and email) and the plan fields of a business, which billing writes.

- Story prefix: `ORG` · ASVS L2: Roles decide who can move money and change rights; team, ownership and closing gestures change other people's access; a public contact decides to whom a customer believes they send money, so it is published only once verified.
- Depends on: `foundation`, `person`, `notification`, `access`, `auth`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `Organization` (design `identite-et-organisation/organization`)
- `Collaboration` (design `identite-et-organisation/collaboration`)
- `OrganizationContact` (design `identite-et-organisation/organizationcontact`)

## Data classification
| data | class | handling |
|---|---|---|
| Organization.name, description, logo_key | public | visible to anyone who finds the business |
| Organization.payment_code, plan, plan_ends_at, grace_ends_at, max_collaborators, max_products | confidential | visible to the team of the business only, never to its customers or suppliers; written by the server only |
| OrganizationContact.value | public | a verified contact is visible to the team and to customers, suppliers and drivers of the business; a pending contact is visible to the team only |
| OrganizationContact.verification_method, created_by_id | internal | visible to the team |
| Collaboration.amount_held | confidential | visible to the collaborator and the owner |
| Collaboration.role | internal | visible to the team |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | E | A member of one business acts in another | every organization route loads the actor from an ACTIVE collaboration of that organization, else 404 | ORG-005 AB-1 |
| T2 | E | A manager or seller changes the team or the owner | team gestures need OWNER and the network | ORG-007 AB-1, ORG-009 AB-1, ORG-010 AB-1 |
| T3 | E | The owner is demoted, revoked or left with two owners | the database keeps exactly one active OWNER and the routes refuse to touch it | ORG-003 AB-1, ORG-010 AB-2 |
| T4 | S | A business is found under a number that is not its own | a contact is published only when it is the owner's own verified number or when its code, received on that number or address, was entered | ORG-024 AB-1, ORG-025 AB-1, ORG-029 AB-1 |
| T5 | I | Enumerating businesses by number | per-person lookup limit shared with person lookups | ORG-018 AB-2 |
| T6 | E | A manager, seller or driver changes the public contacts | the contact gestures need OWNER and the network | ORG-024 AB-2, ORG-027 AB-1 |
| T7 | S | A verification code is guessed, or used on another contact | a code belongs to one contact and its target, allows 5 attempts and is consumed once | ORG-025 AB-2 |
| T8 | S | A recycled number keeps a business findable | a number that changes holder sends its contacts back to pending and warns the owner | ORG-037 AB-1 |
| T9 | I | The plan of a business reaches a customer or a supplier | no organization view returns the plan fields to anyone who is not an ACTIVE member of the team | ORG-028 AB-1 |

## Pointers
- Decision: `docs/stories/decisions/ADR-004-modules-for-design-v16.md`
