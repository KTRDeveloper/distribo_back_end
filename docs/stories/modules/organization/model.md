# Model: organization

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Organization
Design: `identite-et-organisation/organization`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| name | string |  |
| description | text, nullable |  |
| email | string, nullable |  |
| status | enum [ACTIVE / SUSPENDED / CLOSED] | Organization.status:enum, CM-10, CM-26, CM-33 |
| created_at | datetime |  |

- `Organization:required`: NOT NULL: `name`, `status`, `created_at`
- `Organization.status:enum`: one of ACTIVE, SUSPENDED, CLOSED
- `CM-10`: CLOSED (by the owner, reopenable): no new order or customer, not findable by number, pending orders refused with reason 'Commerce fermé', team revoked, subscription stopped; relations, balances and history stay visible and payments stay possible.
- `CM-26`: Finding an organization by number returns only ACTIVE organizations whose public-contact collaborators hold that active number; a number that is not a public organization number leads to an invitation for every person.
- `CM-33`: A SUSPENSION decision sets the target's status to SUSPENDED and revokes the sessions of a suspended person (reason ACCOUNT_SUSPENDED); every decision, and every suspension or reactivation, is logged in AdminAction.

## Collaboration
Design: `identite-et-organisation/collaboration`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| person_id | FK → Person | Collaboration:fk, C-05 |
| organization_id | FK → Organization | Collaboration:fk, C-05 |
| role | enum [OWNER / MANAGER / SELLER / DRIVER] | Collaboration.role:enum, CM-09 |
| status | enum [INVITED / ACTIVE / REVOKED] | Collaboration.status:enum, C-05, CM-09 |
| is_public_contact | boolean | C-05, CM-26 |
| invited_at | datetime |  |
| accepted_at | datetime, nullable |  |
| amount_held | bigint | C-37, CM-17, CM-18 |

- `Collaboration:required`: NOT NULL: `person_id`, `organization_id`, `role`, `status`, `is_public_contact`, `invited_at`, `amount_held`
- `Collaboration.role:enum`: one of OWNER, MANAGER, SELLER, DRIVER
- `Collaboration.status:enum`: one of INVITED, ACTIVE, REVOKED
- `Collaboration:fk`: references person_id → Person; organization_id → Organization
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction; `is_public_contact` needs ACTIVE status and a person with an active number.
- `C-37`: `CustomerRelationship.balance` and `Collaboration.amount_held` are updated by adding the effect of each operation inside its transaction, always relationship first then collaboration; a nightly check compares each total with the sum of its entries.
- `CM-09`: The OWNER can be neither demoted nor revoked; an ownership transfer makes the chosen ACTIVE collaborator OWNER and the former owner MANAGER in one transaction; a revocation takes effect immediately.
- `CM-17`: amount_held = payments recorded minus refunds made, expenses paid and handovers given, plus handovers received; a reversed entry counts the other way; a cancelled expense or handover no longer counts; the owner's amount is tracked but never presented (design lines 717, 721)
- `CM-18`: At ownership transfer the server records a handover from the former owner to themselves for their amount_held, so it restarts at 0.
- `CM-26`: Finding an organization by number returns only ACTIVE organizations whose public-contact collaborators hold that active number; a number that is not a public organization number leads to an invitation for every person.

## Subscription
Design: `finances/subscription`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| organization_id | FK → Organization | Subscription:fk, C-31 |
| plan | string |  |
| status | enum [ACTIVE / EXPIRED] | Subscription.status:enum, C-31 |

- `Subscription:required`: NOT NULL: `organization_id`, `plan`, `status`
- `Subscription.status:enum`: one of ACTIVE, EXPIRED
- `Subscription:fk`: references organization_id → Organization
- `C-31`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); EXPIRED rows stay as history.
