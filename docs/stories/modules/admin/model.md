# Model: admin

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Report
Design: `moderation/report`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| reporter_id | FK → Person | Report:fk, C-04 |
| target_person_id | FK → Person, nullable | Report:fk |
| target_organization_id | FK → Organization, nullable | Report:fk |
| reason | string |  |
| description | text |  |
| status | enum [PENDING / RESOLVED] | Report.status:enum |
| resolved_by_id | FK → Administrator, nullable | Report:fk, C-04 |
| decision | enum [DISMISSED / SUSPENSION], nullable | Report.decision:enum, CM-33 |

- `Report:required`: NOT NULL: `reporter_id`, `reason`, `description`, `status`
- `Report.status:enum`: one of PENDING, RESOLVED
- `Report.decision:enum`: one of DISMISSED, SUSPENSION
- `Report:fk`: references reporter_id → Person; target_person_id → Person; target_organization_id → Organization; resolved_by_id → Administrator
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-28`: A report has exactly one target, a person or an organization.
- `CM-33`: A SUSPENSION decision sets the target's status to SUSPENDED and revokes the sessions of a suspended person (reason ACCOUNT_SUSPENDED); every decision, and every suspension or reactivation, is logged in AdminAction.

## Administrator
Design: `gouvernance-de-la-plateforme/administrator`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| person_id | FK → Person | Administrator:fk, C-04 |
| role | enum [SUPER_ADMIN / MODERATOR] | Administrator.role:enum |
| totp_secret | string | C-29 |
| recovery_email | string, nullable | C-29, CM-34 |
| appointed_at | datetime |  |
| removed_at | datetime, nullable |  |

- `Administrator:required`: NOT NULL: `person_id`, `role`, `totp_secret`, `appointed_at`
- `Administrator.role:enum`: one of SUPER_ADMIN, MODERATOR
- `Administrator:fk`: references person_id → Person
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC, and is immutable. REPLAY_SYNC, GIFT_DAYS, RECORD_PAYMENT, REFUND_PAYMENT, RELEASE_PHONE and RESTORE_ACCESS are for super administrators only; GIFT_DAYS, RECORD_PAYMENT and REFUND_PAYMENT target a business, RELEASE_PHONE and RESTORE_ACCESS a person.
- `CM-34`: A TOTP_RECOVERY code sent to the recovery email only allows installing a new TOTP key; each use is logged as RECOVER_2FA and notified to the administrator's phones and to the other super administrators.

## AdminAction
Design: `gouvernance-de-la-plateforme/adminaction`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| administrator_id | FK → Administrator | AdminAction:fk, C-04 |
| action | enum [SUSPEND / REACTIVATE / DISMISS_REPORT / APPOINT_ADMIN / REMOVE_ADMIN / REPLAY_SYNC / RECOVER_2FA / GIFT_DAYS / RECORD_PAYMENT / REFUND_PAYMENT / RELEASE_PHONE / RESTORE_ACCESS] | AdminAction.action:enum, C-29, CM-40, CM-41 |
| target_person_id | FK → Person, nullable | AdminAction:fk |
| target_organization_id | FK → Organization, nullable | AdminAction:fk |
| report_id | FK → Report, nullable | AdminAction:fk |
| sync_archive_id | FK → SyncArchive, nullable | AdminAction:fk, C-29, CM-32 |
| reason | text | C-29 |
| occurred_at | datetime |  |

- `AdminAction:required`: NOT NULL: `administrator_id`, `action`, `reason`, `occurred_at`
- `AdminAction.action:enum`: one of SUSPEND, REACTIVATE, DISMISS_REPORT, APPOINT_ADMIN, REMOVE_ADMIN, REPLAY_SYNC, RECOVER_2FA
- `AdminAction:fk`: references administrator_id → Administrator; target_person_id → Person; target_organization_id → Organization; report_id → Report; sync_archive_id → SyncArchive
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC, and is immutable. REPLAY_SYNC, GIFT_DAYS, RECORD_PAYMENT, REFUND_PAYMENT, RELEASE_PHONE and RESTORE_ACCESS are for super administrators only; GIFT_DAYS, RECORD_PAYMENT and REFUND_PAYMENT target a business, RELEASE_PHONE and RESTORE_ACCESS a person.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.
- `CM-32`: Only a SUPER_ADMIN replays an archived batch, with a mandatory reason, logged as REPLAY_SYNC; it is judged as if sent by its author with their current rights, never the administrator's; the author and the owner are notified (design lines 936-938)
- `CM-40`: Access restored by support (RESTORE_ACCESS, super administrator only): needs a verified email, a code sent to that email and a code sent to the new number (purpose ACCESS_RESTORE); the number is replaced like a number change (PhoneNumberChangeLog) and every device is signed out; the person is notified; without a verified email support can do nothing (design lines 109, 1078, 1092, 1341-1352)
- `CM-41`: Number released by support (RELEASE_PHONE, super administrator only, mandatory reason): when a former holder who is still active wrongly blocks the new one, support releases the number like a recycled-number claim does; the person is notified (design lines 118, 1078, 1092)
