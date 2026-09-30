---
id: AUTH-009
title: Visitor asks for a registration code
module: auth
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [AUTH-004, PER-005, NTF-002]
read_first: [src/modules/person/person.repository.ts, src/modules/auth/otp.service.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-07]
asvs: [v5.0.0-6.6.1, v5.0.0-2.4.1, v5.0.0-6.3.8]
---

# AUTH-009 — Visitor asks for a registration code

## Story
As a visitor, I want a code sent to my phone number so that I can prove the number is mine before registering.

## Context
- Exists: `issueCode` with caps (AUTH-004); `findByActivePhone`, `normalizeE164`, `isCameroonMobile`.
- Adds: `POST /api/v1/auth/register/request` with body `{ phone_number }`; response 202 `{ sent: true, expires_in: 600, existing_account: null | { masked_name } }`.
- The code goes to the number in every case, with purpose REGISTRATION; `personId` is the holder's id when the number has an active holder, else null.
- `existing_account` is set only when the holder is registered; `masked_name` = first word of `full_name` in full, then the first letter of each further word and "…" (for one word: its first letter and "…"). Example: "Béatrice Ngono" gives "Béatrice N…". This is the one deliberate disclosure the design makes.
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.

## Acceptance criteria
```gherkin
Scenario: AC-1 Unknown number
  When a visitor posts "6 77 12 34 56"
  Then the response is 202 with existing_account null and one REGISTRATION code is queued to +237677123456
Scenario: AC-2 Guest number
  Given a guest holds the number
  Then the response is 202 with existing_account null and the challenge points to the guest
Scenario: AC-3 Registered number
  Given a registered person "Béatrice Ngono" holds the number
  Then the response is 202 with masked_name "Béatrice N…" and the code is queued
Scenario Outline: AC-4 Invalid numbers
  When the number is <number>
  Then the response is <status>
  Examples:
    | number         | status                   |
    | missing        | 400 VALIDATION_ERROR     |
    | 12345          | 400 VALIDATION_ERROR     |
    | +33612345678   | 400 UNSUPPORTED_NUMBER   |
Scenario: AC-5 Limits
  When a fourth code is requested for one number within an hour
  Then the response is 429 `OTP_RATE_LIMITED`
```

## Abuse cases
```gherkin
Scenario: AB-1 SMS pumping through this route (denial of service)
  When 50 requests come from one IP with different foreign numbers
  Then no SMS is queued
Scenario: AB-2 Name disclosure is limited (information disclosure)
  When a registered number is requested
  Then only `masked_name` is returned, never the full name, email or ids
```

## Implementation
- Create: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.openapi.ts`, `tests/integration/auth/register-request.test.ts`
- Modify: `src/app.ts`
- Pattern: `src/modules/tasks/tasks.routes.ts`
- Signatures:
  - `requestRegistrationCode(input: { phone_number: string }, clientKeys: { ip?: string }): Promise<{ sent: true; expires_in: number; existing_account: { masked_name: string } | null }>`
  - `maskName(fullName: string): string`
- Errors: `VALIDATION_ERROR` 400, `UNSUPPORTED_NUMBER` 400, `OTP_RATE_LIMITED` 429
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-6.6.1: SMS only to +237 mobiles.
- v5.0.0-2.4.1: the IP address is passed as a cap key.
- v5.0.0-6.3.8: the response differs only by `masked_name`, which the design requires.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| unknown | integration | AC-1 | 202, queued to normalized number |
| guest | integration | AC-2 | 202, existing_account null, challenge person = guest |
| registered | integration | AC-3 | masked_name "Béatrice N…" |
| invalid | integration | AC-4 | each Examples row → status |
| limits | integration | AC-5, CM-07 | 4th request → 429 |
| pumping | security | AB-1, WSTG-BUSL-07, CWE-770 | 50 foreign numbers → 0 queued |
| disclosure | security | AB-2, CWE-200 | response keys exactly sent, expires_in, existing_account.masked_name |

Command: `npx vitest run tests/integration/auth/register-request.test.ts`

## Out of scope
- Completing the registration (AUTH-010).
