# Model: organization

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Organization
Design: `identite-et-organisation/organization`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| name | string |  |
| description | text, nullable |  |
| logo_key | string, nullable | C-49 |
| status | enum [ACTIVE / SUSPENDED / CLOSED] | Organization.status:enum, CM-10, CM-26, CM-33 |
| payment_code | string, unique | Organization.payment_code:unique, C-41 |
| plan | enum [FREE / ESSENTIAL / PRO / ENTERPRISE] | Organization.plan:enum, C-41 |
| plan_ends_at | datetime, nullable | C-41 |
| grace_ends_at | datetime, nullable | C-41 |
| max_collaborators | int, nullable | C-41, C-42 |
| max_products | int, nullable | C-41, C-46 |
| created_at | datetime |  |

- `Organization:required`: NOT NULL: `name`, `status`, `created_at`
- `Organization.payment_code:unique`: unique
- `Organization.status:enum`: one of ACTIVE, SUSPENDED, CLOSED
- `Organization.plan:enum`: one of FREE, ESSENTIAL, PRO, ENTERPRISE
- `C-41`: `Organization.payment_code` is unique; `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only; `plan = FREE` exactly when `plan_ends_at` is empty; a set `grace_ends_at` is after `plan_ends_at`.
- `C-42`: At each invitation, the ACTIVE or INVITED collaborators of an organization, owner excluded, number at most `Organization.max_collaborators`; the status PAUSED is written by the server only and never for the OWNER.
- `C-46`: `Product.paused_at` is written by the server only; products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (database limit); the application allows `k` of them (5 at most, set at deployment); a key is cited by one card only, across all tables; `image_keys`, `Organization.logo_key` and `Person.avatar_key` are written by the server only.
- `CM-10`: CLOSED (by the owner, reopenable): no new order or customer, not findable by number, pending orders refused with reason 'Commerce fermé', team revoked, plans stopped without refund; relations, balances, history and verified public contacts stay visible and payments stay possible; a reopened business restarts from the free plan.
- `CM-26`: Finding an organization by number returns only ACTIVE organizations that have a verified PHONE contact with that number; a number that is not a verified public number of any organization leads to an invitation for every person.
- `CM-33`: A SUSPENSION decision sets the target's status to SUSPENDED and revokes the sessions of a suspended person (reason ACCOUNT_SUSPENDED); every decision, and every suspension or reactivation, is logged in AdminAction.

## Collaboration
Design: `identite-et-organisation/collaboration`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| person_id | FK → Person | Collaboration:fk, C-05 |
| organization_id | FK → Organization | Collaboration:fk, C-05 |
| role | enum [OWNER / MANAGER / SELLER / DRIVER] | Collaboration.role:enum, CM-09, CM-37 |
| status | enum [INVITED / ACTIVE / PAUSED / REVOKED] | Collaboration.status:enum, C-05, CM-09, CM-39 |
| invited_at | datetime |  |
| accepted_at | datetime, nullable |  |
| amount_held | bigint | C-37, CM-17, CM-18 |

- `Collaboration:required`: NOT NULL: `person_id`, `organization_id`, `role`, `status`, `is_public_contact`, `invited_at`, `amount_held`
- `Collaboration.role:enum`: one of OWNER, MANAGER, SELLER, DRIVER
- `Collaboration.status:enum`: one of INVITED, ACTIVE, REVOKED
- `Collaboration:fk`: references person_id → Person; organization_id → Organization
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction.
- `C-42`: At each invitation, the ACTIVE or INVITED collaborators of an organization, owner excluded, number at most `Organization.max_collaborators`; the status PAUSED is written by the server only and never for the OWNER.
- `C-37`: `CustomerRelationship.balance` and `Collaboration.amount_held` are updated by adding the effect of each operation inside its transaction, always relationship first then collaboration; a nightly check compares each total with the sum of its entries.
- `CM-09`: The OWNER can be neither demoted nor revoked; an ownership transfer makes the chosen ACTIVE collaborator OWNER and the former owner MANAGER in one transaction; a revocation takes effect immediately.
- `CM-17`: amount_held = payments recorded minus refunds made, expenses paid and handovers given, plus handovers received; a reversed entry counts the other way; a cancelled expense or handover no longer counts; the owner's amount is tracked but never presented (design lines 717, 721)
- `CM-18`: At ownership transfer the server records a handover from the former owner to themselves for their amount_held, so it restarts at 0.
- `CM-26`: Finding an organization by number returns only ACTIVE organizations that have a verified PHONE contact with that number; a number that is not a verified public number of any organization leads to an invitation for every person.
- `CM-37`: Ownership transfer: the public contacts stay in place; the new owner is invited to review them (`organization.contacts_review`), with a mention on a contact that is the former owner's number, never on his email, which is private (design lines 212, 1105)
- `CM-39`: A paused member keeps the money they hold, visible to the owner: for the payer of an expense and the person who hands money over, a paused member counts like a departed one, so that money can be collected and expenses recorded (design lines 201, 920)

## OrganizationContact
Design: `identite-et-organisation/organizationcontact`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| organization_id | FK → Organization | OrganizationContact:fk, C-43 |
| kind | enum [PHONE / EMAIL] | OrganizationContact.kind:enum, C-43 |
| slot | int, nullable | C-43 |
| value | string | C-43, CM-36, CM-37 |
| verified_at | datetime, nullable | C-43, C-44, CM-36 |
| verification_method | enum [CODE / OWNER_PHONE], nullable | OrganizationContact.verification_method:enum, C-43, C-44, CM-36 |
| created_by_id | FK → Person | OrganizationContact:fk |
| created_at | datetime |  |

- `OrganizationContact:required`: NOT NULL: `organization_id`, `kind`, `value`, `created_by_id`, `created_at`
- `OrganizationContact.kind:enum`: one of PHONE, EMAIL
- `OrganizationContact.verification_method:enum`: one of CODE, OWNER_PHONE
- `OrganizationContact:fk`: references organization_id → Organization; created_by_id → Person
- `C-43`: `OrganizationContact`: `slot` is set exactly when `kind = PHONE` and is between 1 and 3, unique per (`organization_id`, `slot`); at most one EMAIL per organization (partial unique index); unique per (`organization_id`, `value`); a PHONE `value` is in E.164 format; `verification_method` is set exactly when `verified_at` is set; all these uniqueness rules ignore deleted rows.
- `C-44`: `OrganizationContact` is written by the owner only, online; `verified_at` and `verification_method` are set by the server.
- `CM-36`: When a phone number changes holder (recycled number), every `OrganizationContact` with that number goes back to pending (`verified_at` and `verification_method` cleared), is no longer published, and the owner is notified; when the owner changes their own number, nothing changes by itself.
- `CM-37`: Ownership transfer: the public contacts stay in place; the new owner is invited to review them (`organization.contacts_review`), with a mention on a contact that is the former owner's number, never on his email, which is private (design lines 212, 1105)
