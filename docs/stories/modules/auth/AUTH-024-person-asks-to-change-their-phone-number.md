---
id: AUTH-024
title: Person asks to change their phone number
module: auth
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [AUTH-004, PER-005, AUTH-009, AUTH-010]
read_first: [src/modules/auth/auth.service.ts, src/modules/person/person.repository.ts]
design_refs: [identite-et-organisation/person]
constraints: [C-33, C-02, CM-07]
asvs: [v5.0.0-6.5.1, v5.0.0-6.6.1, v5.0.0-2.4.1]
---

# AUTH-024 — Person asks to change their phone number

## Story
As a customer, I want a code sent to my new number so that I can move my account to it.

## Context
- Exists: `issueCode`, `findByActivePhone`, `isCameroonMobile`.
- Adds: `POST /api/v1/auth/phone/change/request` (authenticated) with `{ new_phone_number }`; response 202 `{ sent: true, expires_in: 600 }`; a PHONE_CHANGE code goes by SMS to the new number.
- Refused: not a Cameroon mobile (400 `UNSUPPORTED_NUMBER`); the person's own active number (400 `SAME_NUMBER`); a number with any other active holder, registered or guest (409 `PHONE_TAKEN`, Q-031).
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` is empty.
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.

## Acceptance criteria
```gherkin
Scenario: AC-1 Code sent
  When a signed-in person posts a free Cameroon mobile number
  Then the response is 202 and one PHONE_CHANGE code is queued to that number
Scenario Outline: AC-2 Refusals
  When the new number is <case>
  Then the response is <status> and nothing is queued
  Examples:
    | case                                  | status                  |
    | their own active number               | 400 SAME_NUMBER         |
    | held by another registered person     | 409 PHONE_TAKEN         |
    | held by a guest                       | 409 PHONE_TAKEN         |
    | +33612345678                          | 400 UNSUPPORTED_NUMBER  |
    | missing                               | 400 VALIDATION_ERROR    |
Scenario: AC-3 Limits
  When a fourth code is requested for one number within an hour
  Then the response is 429 `OTP_RATE_LIMITED`
```

## Abuse cases
```gherkin
Scenario: AB-1 Probing which numbers are registered (information disclosure)
  When a person tries many numbers
  Then the 409 answer carries no name or id and the rate limits apply
Scenario: AB-2 No token (unauthenticated)
  When the request has no valid token
  Then the response is 401
```

## Implementation
- Create: `tests/integration/auth/phone-change-request.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `requestPhoneChange(personId: string, input: { new_phone_number: string }, clientKeys: { ip?: string }): Promise<{ sent: true; expires_in: number }>`
- Errors: `SAME_NUMBER` 400, `PHONE_TAKEN` 409, `UNSUPPORTED_NUMBER` 400, `OTP_RATE_LIMITED` 429
- Dependencies: `express`, `zod`

## Security
- v5.0.0-6.6.1: the code goes to the new number only, +237 only.
- v5.0.0-2.4.1: per-number, device and IP caps apply.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| code sent | integration | AC-1, C-33 | queued to the new number |
| refusals | integration | AC-2, C-02 | each Examples row → status, no job |
| limits | integration | AC-3, CM-07 | 4th → 429 |
| probing | security | AB-1, WSTG-IDNT-04 | 409 body has no name or id |
| no token | security | AB-2, WSTG-ATHN-04 | 401 |

Command: `npx vitest run tests/integration/auth/phone-change-request.test.ts`

## Out of scope
- Confirming the code and moving the number (AUTH-025).
