---
id: AUTH-032
title: Registering on a recycled number re-checks the old holder
module: auth
kind: change
rev: 1
amends: [AUTH-011]
size: S
risk: high
depends_on: [AUTH-031, AUTH-030, AUTH-011, PER-014]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/number-claim.service.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-04, C-02]
asvs: [v5.0.0-8.2.2, v5.0.0-6.4.3, v5.0.0-16.3.1]
---

# AUTH-032 — Registering on a recycled number re-checks the old holder

## Story
As a visitor, I want my registration on a recycled number to be refused if the old holder came back so that nobody can take the number of a live account.

## Context
- Exists: `register` with `new_holder: true` releases a registered holder in one transaction (`releaseRegisteredHolder`), notifies them (`phone.taken_over`) and registers the new person; `claimRefusal` (AUTH-031); `firePhoneReleased(phoneNumber, tx)` from `src/modules/person/phone-released.ts` (PER-014).
- With `new_holder: true` and a registered holder, the code is checked as before, then `claimRefusal` runs before the code is spent: a refusal answers 409 `NUMBER_NOT_AVAILABLE`, the code stays unspent and nothing changes. The rule is checked again here because the holder may have come back between the claim and the registration.
- After the release and inside the same transaction, `firePhoneReleased(phone, tx)` runs, so the shop contacts that carry the number go back to pending (ORG-037). If a handler throws, the whole registration is rolled back and the old holder keeps the number.
- A holder with no device is idle. A device counts as activity from its creation (AUTH-031), so the AUTH-011 fixture that creates one is backdated (see Tests to update). Without `new_holder`, a registered holder still answers 409 `ACCOUNT_EXISTS`.
- `CM-04`: releasing a number moves it to `released_phone_number`. `C-02`: one number, one holder.
- `CM-04`: Releasing a number moves it from phone_number to released_phone_number and clears phone_verified_at; lookups, SMS and registration read only the active number (design line 71)
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` and `avatar_key` are empty.

## Acceptance criteria
```gherkin
Scenario: AC-1 Idle holder released
  Given a registered holder idle for 7 months and a valid code
  When the visitor registers with new_holder true
  Then the response is 201, the holder's number is released and `firePhoneReleased` ran once with the number
Scenario Outline: AC-2 Refused
  Given the holder is <holder>
  When the visitor registers with new_holder true and a valid code
  Then the response is 409 `NUMBER_NOT_AVAILABLE`, the holder keeps the number and the code is unspent
  Examples:
    | holder                                       |
    | active, last synchronization 5 months ago    |
    | suspended, last synchronization 2 years ago  |
Scenario: AC-3 A failing handler undoes the release
  Given a handler that throws
  When the visitor registers with new_holder true
  Then the answer is 500, no person is created and the old holder keeps the number
Scenario: AC-4 No holder to release
  When new_holder is true and the number is unknown or a guest's
  Then the visitor is registered as usual and no handler runs
```

## Abuse cases
```gherkin
Scenario: AB-1 A code kept while the holder was idle (elevation)
  Given a claim code obtained when the holder was idle, and the holder synchronizes afterwards
  When the visitor registers with new_holder true
  Then the response is 409 and the holder keeps the account and the number
```

## Implementation
- Create: `tests/integration/auth/register-recycled-recheck.test.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Signatures:
  - `releaseHolderAndRegister(input: RegisterInput): Promise<SessionResponse>`
- Errors: `NUMBER_NOT_AVAILABLE` 409, `ACCOUNT_EXISTS` 409, `OTP_INVALID` 400
- Dependencies: `@prisma/client`, `zod`

## Security
- v5.0.0-8.2.2: nothing owned by the old holder moves; a refusal leaves the account as it was.
- v5.0.0-6.4.3: a code alone does not give a live number: the holder's activity is checked again.
- v5.0.0-16.3.1: a refusal is logged with the holder id.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| idle holder released | integration | AC-1, CM-04, C-02 | 201; number released; handler called once |
| refused | integration | AC-2 | each Examples row → 409; code still valid |
| handler fails | integration | AC-3 | throwing handler → 500; holder unchanged; no new person |
| no holder | integration | AC-4 | unknown and guest numbers → 201; handler not called |
| stale code | security | AB-1, CWE-367 | holder synchronizes between claim and register → 409 |

Command: `npx vitest run tests/integration/auth/register-recycled-recheck.test.ts tests/integration/auth/register-new-holder.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth/register-new-holder.test.ts | the claim check and the release hook run on the same path; its `seedHolder` creates a device dated now, so the holder is recently active and the re-check refuses with 409 | `seedHolder` backdates the device's creation by more than six months (an idle holder); every assertion stays as it is |

## Out of scope
- What a handler does with the number (ORG-037 for shop contacts).
- The text of the notice to the old holder: it does not change.
