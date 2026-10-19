---
id: AUTH-031
title: A recycled number can be claimed after six idle months
module: auth
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [AUTH-029, AUTH-011, AUTH-007]
read_first: [src/modules/auth/auth.repository.ts, src/modules/auth/otp.service.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-07]
asvs: [v5.0.0-2.4.1, v5.0.0-6.3.8, v5.0.0-16.3.1]
---

# AUTH-031 — A recycled number can be claimed after six idle months

## Story
As a visitor, I want to ask for a code for a number that used to belong to someone else so that I can create my own account.

## Context
- Exists: `findByActivePhone`, `issueCode(input, clientKeys)`, `checkNumberQuota` (AUTH-028); devices keep `last_synced_at` and stay in the table when revoked.
- Adds `POST /api/v1/auth/register/claim` with `{ phone_number }`, answer 202 `{ sent: true, expires_in: 600 }`. It calls `checkNumberQuota` first.
- Refusal, before any code: 409 `NUMBER_NOT_AVAILABLE`, one body for both reasons so a suspension is never shown. The holder is suspended, or their latest device activity is within 6 months (the same date and time six calendar months earlier, UTC). Activity = the latest `COALESCE(last_synced_at, created_at)` over all their devices, revoked ones included; a device that never synchronized counts from its creation, so a new account is protected (open question). A holder with no device is idle.
- `claimRefusal(holder, now)` returns `SUSPENDED`, `RECENTLY_ACTIVE` or null and is exported for AUTH-032 and AUTH-037. The repository adds `latestDeviceActivity(personId)`.
- Allowed: a REGISTRATION code goes by SMS to the number with `personId` null. A number with no registered holder is treated alike: the code is sent. A refusal logs `warn` event `number_claim_refused` with the holder id and the reason.
- `Device` fields: `last_synced_at` datetime, nullable; `created_at` datetime; `revoked_at` datetime, nullable
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.

## Acceptance criteria
```gherkin
Scenario: AC-1 Idle holder
  Given a registered active holder whose devices last synchronized 7 months ago
  When a visitor claims the number
  Then the response is 202 and one REGISTRATION code is queued with a challenge whose person is empty
Scenario Outline: AC-2 Refused
  Given the holder is <holder>
  When a visitor claims the number
  Then the response is 409 `NUMBER_NOT_AVAILABLE` with the same body, and no challenge or job exists
  Examples:
    | holder                                                     |
    | active, last synchronization 5 months ago                  |
    | active, last synchronization yesterday on a revoked device |
    | suspended, last synchronization 2 years ago                |
    | active, one device created 2 days ago, never synchronized  |
Scenario: AC-3 Limits
  When one IP claims 3 numbers with the limit at 2, or a fourth code is asked for one number in an hour
  Then the answer is 429 `RATE_LIMITED` or 429 `OTP_RATE_LIMITED`
Scenario: AC-4 No registered holder
  When a visitor claims an unknown number
  Then the response is 202 and a code is queued
```

## Abuse cases
```gherkin
Scenario: AB-1 Claiming a live number to flood its holder (denial of service)
  When 100 claims name the number of an active holder
  Then no code is sent
Scenario: AB-2 Suspension shown to the claimant (information disclosure)
  When the refusals of a suspended holder and of an active holder are compared
  Then status, code and body are identical
```

## Implementation
- Create: `src/modules/auth/number-claim.service.ts`, `tests/integration/auth/number-claim.test.ts`
- Modify: `src/modules/auth/auth.repository.ts`, `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Signatures:
  - `requestNumberClaim(input: { phone_number: string }, clientKeys: ClientKeys): Promise<{ sent: true; expires_in: number }>`
  - `claimRefusal(holder: { id: string; status: string }, now: Date): Promise<'SUSPENDED' | 'RECENTLY_ACTIVE' | null>`
  - `latestDeviceActivity(personId: string): Promise<Date | null>`
- Errors: `NUMBER_NOT_AVAILABLE` 409, `RATE_LIMITED` 429, `OTP_RATE_LIMITED` 429, `VALIDATION_ERROR` 400, `UNSUPPORTED_NUMBER` 400
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`, `@prisma/client`

## Security
- v5.0.0-2.4.1: number checks and code sends are limited, so the route cannot flood a code.
- v5.0.0-6.3.8: both refusals answer alike, so a suspension is never revealed.
- v5.0.0-16.3.1: refusals are logged with ids and the reason, never the number.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| idle holder | integration | AC-1 | 202; challenge person_id empty |
| refused | integration | AC-2 | each Examples row → 409, equal bodies, nothing created |
| limits | integration | AC-3, CM-07 | quota 429 RATE_LIMITED; fourth code 429 OTP_RATE_LIMITED |
| no registered holder | integration | AC-4 | unknown number → 202, one job |
| flooding | security | AB-1, CWE-799 | 100 claims → zero codes |
| refusals alike | security | AB-2, CWE-204 | suspended vs active → equal bodies |

Command: `npx vitest run tests/integration/auth/number-claim.test.ts`

## Out of scope
- Warning the active holder (AUTH-037).
- Registering with the code and releasing the old holder (AUTH-032).
- Support releasing a number by hand (RELEASE_PHONE, admin module).
