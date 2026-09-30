# Model: person

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Person
Design: `identite-et-organisation/person`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| full_name | string, nullable | C-03, CM-01, CM-20 |
| phone_number | string, nullable, unique | Person.phone_number:unique, C-02, C-03, CM-01, CM-04, CM-20, CM-26 |
| released_phone_number | string, nullable | C-02, CM-01, CM-04 |
| phone_verified_at | datetime, nullable | C-03, CM-04 |
| email | string, nullable | C-03, C-29, CM-01 |
| email_verified_at | datetime, nullable | C-03, CM-01 |
| password_hash | string, nullable | C-03, CM-01, CM-05 |
| registered_at | datetime, nullable | C-03, CM-20 |
| preferred_language | enum [FR / EN], nullable | Person.preferred_language:enum, CM-01 |
| created_at | datetime |  |
| status | enum [ACTIVE / SUSPENDED / ANONYMIZED] | Person.status:enum, C-02, C-03, C-05, CM-33 |
| anonymized_at | datetime, nullable | CM-02 |
| scope_version | int | CM-03, CM-29 |

- `Person:required`: NOT NULL: `created_at`, `status`, `scope_version`
- `Person.phone_number:unique`: unique
- `Person.preferred_language:enum`: one of FR, EN
- `Person.status:enum`: one of ACTIVE, SUSPENDED, ANONYMIZED
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` is empty.
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.
- `C-05`: `Collaboration` is unique per person and organization; an ACTIVE collaboration needs a registered person; exactly one ACTIVE OWNER per organization; `is_public_contact` needs ACTIVE status and a person with an active number. Owned by the organization module.
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC (super administrators only), and is immutable. Owned by the admin module.
- `CM-01`: Anonymization erases full_name, email, email_verified_at, preferred_language and password_hash, releases the number (moves it to released_phone_number), sets status ANONYMIZED and anonymized_at (design lines 67, 68)
- `CM-02`: Account deletion is refused while the person has a positive balance on a relation where they are the customer, or owns an organization that is neither transferred nor closed (design lines 68, 73)
- `CM-03`: `scope_version` is incremented by the server on every rights change.
- `CM-04`: Releasing a number moves it from phone_number to released_phone_number and clears phone_verified_at; lookups, SMS and registration read only the active number (design line 71)
- `CM-05`: Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the common or leaked password blocklist; hashed with Argon2id; 5 failed attempts force a wait (design lines 63, 108-111)
- `CM-20`: An organization receives from a person only the public name, the number and whether they are registered.
- `CM-26`: Finding an organization by number returns only ACTIVE organizations whose public-contact collaborators hold that active number; a number that is not a public organization number leads to an invitation for every person, registered or not (design lines 148, 154, 262)
- `CM-29`: First send after a rights change (scope_version_seen older than scope_version): judged with current rights; seller operations (sales, deliveries, collections) are always accepted and reported to the owner, any other forbidden operation is refused and reported (design lines 883-887)
- `CM-33`: A SUSPENSION decision sets the target's status to SUSPENDED and revokes the sessions of a suspended person (reason ACCOUNT_SUSPENDED); every decision, and every suspension or reactivation, is logged in AdminAction (design lines 760-762, 806)

## PhoneNumberChangeLog
Design: `identite-et-organisation/phonenumberchangelog`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| person_id | FK → Person | PhoneNumberChangeLog:fk |
| old_phone_number | string |  |
| new_phone_number | string |  |
| verified_at | datetime |  |
| changed_at | datetime |  |

- `PhoneNumberChangeLog:required`: NOT NULL: `person_id`, `old_phone_number`, `new_phone_number`, `verified_at`, `changed_at`
- `PhoneNumberChangeLog:fk`: references person_id → Person
- `C-32`: `PhoneNumberChangeLog` rows are never updated or deleted by the application; only the retention purge removes them.
- `C-39`: The application account has only INSERT and SELECT on `PhoneNumberChangeLog`.
