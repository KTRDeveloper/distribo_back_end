---
id: AUTH-025
title: Person moves their account to the new number
module: auth
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [AUTH-024, PER-004]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/auth.repository.ts]
design_refs: [identite-et-organisation/person, identite-et-organisation/phonenumberchangelog]
constraints: [C-02, C-03, CM-04, C-32]
asvs: [v5.0.0-6.5.1, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# AUTH-025 — Person moves their account to the new number

## Story
As a customer, I want to confirm the code so that my account moves to the new number and the change is recorded.

## Context
- Exists: PHONE_CHANGE codes (AUTH-024); `phone_number_change_logs` (PER-004); `people` checks (PER-003).
- Adds: `POST /api/v1/auth/phone/change/confirm` (authenticated) with `{ new_phone_number, code }`; response 204.
- In one transaction: recheck that no other person holds the number, set `phone_number` = new number and `phone_verified_at` = now, clear `released_phone_number` when it was set (a person whose number was taken adds a new one this way), and insert one journal row (`old_phone_number` = the previous active or released number, `new_phone_number`, `verified_at`, `changed_at`).
- Race for one number: the loser gets 409 `PHONE_TAKEN`. Logs `info` event `phone_changed` with the person id.
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` is empty.
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.
- `CM-04`: Releasing a number moves it from phone_number to released_phone_number and clears phone_verified_at; lookups, SMS and registration read only the active number.
- `C-32`: `PhoneNumberChangeLog` rows are never updated or deleted by the application; only the retention purge removes them.

## Acceptance criteria
```gherkin
Scenario: AC-1 Change
  When the right code for the new number is posted
  Then the response is 204, `phone_number` is the new number, `phone_verified_at` is now, and one journal row holds old and new numbers
Scenario: AC-2 After a taken number
  Given the person's number was released to a new holder
  When they confirm a code for a new number
  Then `phone_number` is the new number, `released_phone_number` is empty and the journal's old number is the released one
Scenario: AC-3 Wrong, expired or foreign code
  When the code is wrong, expired, or was sent to another number
  Then the response is 400 `OTP_INVALID` or `OTP_EXPIRED` and nothing changes
Scenario: AC-4 Number taken meanwhile
  When another person registers the number before the confirmation
  Then the response is 409 `PHONE_TAKEN`, nothing changes and no journal row is written
Scenario: AC-5 Atomic
  When the journal insert fails
  Then the number is unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 Moving to a number without its SIM (spoofing)
  When a signed-in person posts a number with no valid code
  Then the number is unchanged
Scenario: AB-2 Changes are traceable (repudiation)
  When a number changes
  Then the application account cannot update or delete the journal row
```

## Implementation
- Create: `tests/integration/auth/phone-change-confirm.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.repository.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `confirmPhoneChange(personId: string, input: { new_phone_number: string; code: string }): Promise<void>`
- Errors: `OTP_INVALID` 400, `OTP_EXPIRED` 400, `PHONE_TAKEN` 409, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-6.5.1: the code is bound to the new number and the purpose.
- v5.0.0-2.3.3: number update and journal row are one transaction.
- v5.0.0-16.3.1: the change is logged.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| change | integration | AC-1, CM-04, C-02 | 204, new number, one journal row |
| after taken number | integration | AC-2, C-03 | released cleared, journal old = released |
| bad code | integration | AC-3 | errors, unchanged |
| taken meanwhile | integration | AC-4 | 409, no journal |
| atomic | integration | AC-5, CWE-362 | forced journal failure → number unchanged |
| no code | security | AB-1, CWE-287 | unchanged |
| journal immutable | security | AB-2, C-32, CWE-778 | `distribo_app` cannot update or delete the row |

Command: `npx vitest run tests/integration/auth/phone-change-confirm.test.ts`

## Out of scope
- Notifying other devices of the change.
