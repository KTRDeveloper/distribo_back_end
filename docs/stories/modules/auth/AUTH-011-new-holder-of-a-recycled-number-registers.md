---
id: AUTH-011
title: New holder of a recycled number registers
module: auth
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [AUTH-010, NTF-002]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/auth.repository.ts]
design_refs: [identite-et-organisation/person]
constraints: [C-02, CM-04, CM-03]
asvs: [v5.0.0-6.4.3, v5.0.0-16.3.1, v5.0.0-8.2.2]
---

# AUTH-011 — New holder of a recycled number registers

## Story
As a visitor, I want to say "this number is new to me" so that I get a new account and the previous holder keeps theirs.

## Context
- Exists: `POST /api/v1/auth/register` (AUTH-010); `bumpScopeVersion`, `releasePhoneNumber` rule of PER (CM-04); `notify`; `enqueueOtpDelivery` for the email.
- Adds: optional `new_holder: true` in the register body. With it, a registered holder of the number is released in one transaction: `phone_number` moves to `released_phone_number`, `phone_verified_at` is emptied, `scope_version` is bumped; then a new registered person takes the number (as AUTH-010).
- The previous holder is notified: a notification `phone.taken_over` (content: "Votre numéro est maintenant utilisé par quelqu'un d'autre. Ajoutez votre nouveau numéro.") and, when their email is verified, an email with the same text and no number. Their account, history and sessions are untouched.
- `new_holder: true` with a guest or unused number behaves as a normal registration. The code is still required.
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` is empty.
- `CM-04`: Releasing a number moves it from phone_number to released_phone_number and clears phone_verified_at; lookups, SMS and registration read only the active number.
- `CM-03`: `scope_version` is incremented by the server on every rights change.

## Acceptance criteria
```gherkin
Scenario: AC-1 Recycled number
  Given a registered person P holds +237677123456 and a visitor proves the number with a code
  When the visitor registers with new_holder true
  Then P has phone_number empty, released_phone_number +237677123456, phone_verified_at empty and scope_version increased by 1
  And a new registered person holds the number and receives tokens
Scenario: AC-2 Previous holder is told
  Then P has an unread notification with source_event `phone.taken_over`
  And when P's email is verified one email job is queued without the phone number in its text
Scenario: AC-3 History is kept
  Then P keeps id, name, relationships and sessions, and P's relationships still point to P
Scenario: AC-4 Without a code
  When new_holder is true and the code is wrong
  Then the response is 400 `OTP_INVALID` and nobody is released
Scenario: AC-5 Atomic
  When the new person's insert fails
  Then P still holds the number
```

## Abuse cases
```gherkin
Scenario: AB-1 Taking over an account by claiming a number is new (elevation)
  When an attacker with the SIM registers with new_holder true
  Then the attacker gets a new empty person and no data, relationship or session of P
Scenario: AB-2 Released number stays out of lookups (information disclosure)
  When someone looks up the released number
  Then it answers as an unknown number
```

## Implementation
- Create: `tests/integration/auth/register-new-holder.test.ts`
- Modify: `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.repository.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `releaseHolderAndRegister(input: RegisterInput): Promise<SessionResponse>`
- Types:
  - `RegisterInput = RegisterInput & { new_holder?: boolean }`
- Errors: `OTP_INVALID` 400, `ACCOUNT_EXISTS` 409
- Dependencies: `@prisma/client`, `zod`, `bullmq`

## Security
- v5.0.0-6.4.3: the code proves the SIM; the previous holder is warned on every channel we have.
- v5.0.0-8.2.2: nothing owned by the previous holder is reassigned.
- v5.0.0-16.3.1: log event `phone_released` with both person ids.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| recycled | integration | AC-1, CM-04, CM-03, C-02 | release and new person as described |
| previous holder told | integration | AC-2 | notification row; email job without number |
| history kept | integration | AC-3 | ids and relations unchanged |
| no code | integration | AC-4 | wrong code → nobody released |
| atomic | integration | AC-5 | forced insert failure → P unchanged |
| takeover attempt | security | AB-1, CWE-287 | attacker gets an empty new person only |
| lookup | security | AB-2, CWE-200 | released number → looks unknown |

Command: `npx vitest run tests/integration/auth/register-new-holder.test.ts`

## Out of scope
- Public-contact flag cleared for the previous holder (ORG-003).
- Signing in by verified email (AUTH-014).
