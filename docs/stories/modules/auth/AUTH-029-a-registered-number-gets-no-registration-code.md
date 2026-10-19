---
id: AUTH-029
title: A registered number gets no registration code
module: auth
kind: change
rev: 1
amends: [AUTH-009]
size: S
risk: high
depends_on: [AUTH-028, AUTH-009]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/number-check-limit.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-07, C-02]
asvs: [v5.0.0-2.4.1, v5.0.0-6.6.1, v5.0.0-8.2.2]
---

# AUTH-029 — A registered number gets no registration code

## Story
As a visitor, I want the registration screen to tell me when my number already has an account so that I do not register twice.

## Context
- Exists: `requestRegistrationCode` sends a REGISTRATION code to every number and answers 202 `{ sent: true, expires_in, existing_account }`; `maskName`; `checkNumberQuota` (AUTH-028).
- `POST /api/v1/auth/register/request` calls `checkNumberQuota` first. Unknown number or guest: a code is sent, as today. Registered holder: no code and no challenge; the answer is 202 `{ sent: false, expires_in: 0, existing_account: { masked_name } }` and the phone asks "Is this your account?".
- The recycled-number path no longer starts here: a visitor who says "not me" calls the claim route (AUTH-031).
- The answer carries the masked name only: never a photo address, id or email, even though the person now has a photo (PER-011).
- `CM-07`: sending limits per number, device and IP; a registered holder is no longer a target of this route, so it cannot be used to flood their phone.
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` and `avatar_key` are empty.

## Acceptance criteria
```gherkin
Scenario: AC-1 Unknown number
  When a visitor posts "6 77 12 34 56"
  Then the response is 202 with sent true and existing_account null, and one REGISTRATION code is queued to +237677123456
Scenario: AC-2 Guest number
  Given a guest holds the number
  Then the response is 202 with sent true, existing_account null, and the challenge points to the guest
Scenario: AC-3 Registered number
  Given a registered person "Béatrice Ngono" holds the number
  Then the response is 202 with sent false, expires_in 0 and masked_name "Béatrice N…"
  And no challenge exists and nothing is queued
Scenario: AC-4 Number checks are counted
  Given the limit is 2 per hour and per IP
  When one IP posts 3 numbers
  Then the third answers 429 `RATE_LIMITED`
```

## Abuse cases
```gherkin
Scenario: AB-1 Flooding a registered person with codes (denial of service)
  When 10 requests name the number of a registered person
  Then no SMS is queued
Scenario: AB-2 More than the masked name is shown (information disclosure)
  When a registered number is posted
  Then `existing_account` holds only `masked_name`
```

## Implementation
- Create: `tests/integration/auth/register-request-no-code.test.ts`
- Modify: `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Signatures:
  - `requestRegistrationCode(input: { phone_number: string }, clientKeys: ClientKeys): Promise<{ sent: boolean; expires_in: number; existing_account: { masked_name: string } | null }>`
- Errors: `VALIDATION_ERROR` 400, `UNSUPPORTED_NUMBER` 400, `OTP_RATE_LIMITED` 429, `RATE_LIMITED` 429
- Dependencies: `express`, `zod`

## Security
- v5.0.0-2.4.1: number checks and code sends are limited by IP, and a registered number sends nothing.
- v5.0.0-6.6.1: SMS still goes only to +237 mobiles.
- v5.0.0-8.2.2: the answer is built from an explicit field list: the masked name and nothing else of the holder.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| unknown number | integration | AC-1, CM-07 | 202 sent true, one job |
| guest number | integration | AC-2 | challenge person_id is the guest |
| registered number | integration | AC-3, C-02 | 202 sent false, masked name; zero challenges, zero jobs |
| number checks | integration | AC-4 | limit 2 → third 429 |
| no flooding | security | AB-1, CWE-400 | 10 requests → zero jobs |
| masked name only | security | AB-2, CWE-200 | existing_account has the key masked_name only |

Command: `npx vitest run tests/integration/auth/register-request-no-code.test.ts tests/integration/auth/register-request.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth/register-request.test.ts | the 'registered' case expects the code queued and `sent: true` | expects `sent: false`, `expires_in: 0`, the masked name, no challenge and no job |

## Out of scope
- The claim of a recycled number (AUTH-031, AUTH-032).
- Listing what is attached to the number after the code (relationship and organization modules).
