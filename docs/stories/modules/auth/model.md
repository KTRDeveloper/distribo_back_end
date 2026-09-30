# Model: auth

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## OtpChallenge
Design: `acces-et-securite/otpchallenge`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| person_id | FK → Person, nullable | OtpChallenge:fk |
| target | string | C-33, CM-07 |
| purpose | enum [REGISTRATION / LOGIN / PASSWORD_RESET / PHONE_CHANGE / EMAIL_VERIFICATION / TOTP_RECOVERY] | OtpChallenge.purpose:enum, CM-34 |
| channel | enum [SMS / EMAIL] | OtpChallenge.channel:enum, C-33, CM-07 |
| code_hash | string |  |
| expires_at | datetime | CM-06 |
| attempts | int | C-33 |
| consumed_at | datetime, nullable | CM-06 |
| created_at | datetime |  |

- `OtpChallenge:required`: NOT NULL: `target`, `purpose`, `channel`, `code_hash`, `expires_at`, `attempts`, `created_at`
- `OtpChallenge.purpose:enum`: one of REGISTRATION, LOGIN, PASSWORD_RESET, PHONE_CHANGE, EMAIL_VERIFICATION, TOTP_RECOVERY
- `OtpChallenge.channel:enum`: one of SMS, EMAIL
- `OtpChallenge:fk`: references person_id → Person
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.
- `CM-06`: A code expires 10 minutes after sending and works once.
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.
- `CM-34`: A TOTP_RECOVERY code sent to the recovery email only allows installing a new TOTP key; each use is logged as RECOVER_2FA and notified to the administrator's phones and to the other super administrators (design lines 783, 1049)

## Device
Design: `acces-et-securite/device`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| person_id | FK → Person | Device:fk |
| platform | enum [ANDROID / IOS] | Device.platform:enum |
| model | string, nullable |  |
| push_token | string, nullable |  |
| app_version | string | CM-31 |
| last_synced_at | datetime, nullable | C-34, CM-31 |
| scope_version_seen | int | C-34, CM-03, CM-29 |
| integrity_verdict | string, nullable |  |
| created_at | datetime |  |
| revoked_at | datetime, nullable |  |

- `Device:required`: NOT NULL: `person_id`, `platform`, `app_version`, `scope_version_seen`, `created_at`
- `Device.platform:enum`: one of ANDROID, IOS
- `Device:fk`: references person_id → Person
- `C-34`: `Device.last_synced_at` and `Device.scope_version_seen` are set by the server only; `RefreshToken.token_hash` is unique; `revoked_reason` is set if and only if `revoked_at` is set.
- `CM-03`: `scope_version` is incremented by the server on every rights change.
- `CM-29`: First send after a rights change (scope_version_seen older than scope_version): judged with current rights; seller operations (sales, deliveries, collections) are always accepted and reported to the owner, any other forbidden operation is refused and reported (design lines 883-887)
- `CM-31`: The server refuses a sync from an app version below the platform minimum; a phone clock more than 5 minutes off makes the app ask for automatic time; operations dated in the future or more than 3 days after the phone's last sync are reported to the owner, never refused (design lines 919-923)

## RefreshToken
Design: `acces-et-securite/refreshtoken`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| person_id | FK → Person | RefreshToken:fk |
| device_id | FK → Device | RefreshToken:fk, CM-08 |
| token_hash | string, unique | RefreshToken.token_hash:unique, C-34 |
| expires_at | datetime | CM-08 |
| created_at | datetime |  |
| rotated_at | datetime, nullable | CM-08 |
| revoked_at | datetime, nullable | C-34, CM-08 |
| revoked_reason | enum [LOGOUT / DEVICE_REMOVED / LOGOUT_ALL / REUSE_DETECTED / PASSWORD_RESET / ACCOUNT_SUSPENDED], nullable | RefreshToken.revoked_reason:enum, C-34 |

- `RefreshToken:required`: NOT NULL: `person_id`, `device_id`, `token_hash`, `expires_at`, `created_at`
- `RefreshToken.token_hash:unique`: unique
- `RefreshToken.revoked_reason:enum`: one of LOGOUT, DEVICE_REMOVED, LOGOUT_ALL, REUSE_DETECTED, PASSWORD_RESET, ACCOUNT_SUSPENDED
- `RefreshToken:fk`: references person_id → Person; device_id → Device
- `C-34`: `Device.last_synced_at` and `Device.scope_version_seen` are set by the server only; `RefreshToken.token_hash` is unique; `revoked_reason` is set if and only if `revoked_at` is set.
- `CM-08`: Access token (JWT) lives 15 minutes and is not stored; refresh token lives 90 days, extended at each use, replaced at each use; a reused token revokes only its own device session (REUSE_DETECTED).
