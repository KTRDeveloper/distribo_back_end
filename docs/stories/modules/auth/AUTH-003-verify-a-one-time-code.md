---
id: AUTH-003
title: Verify a one-time code
module: auth
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [AUTH-002]
read_first: [src/modules/auth/otp.service.ts, src/modules/auth/otp.repository.ts]
design_refs: [acces-et-securite/otpchallenge]
constraints: [CM-06, C-33]
asvs: [v5.0.0-6.5.1, v5.0.0-6.5.3, v5.0.0-6.6.3, v5.0.0-2.3.4]
---

# AUTH-003 — Verify a one-time code

## Story
Technical story: check a submitted code against the latest one issued, so that a code works once, expires, and cannot be guessed by repeated tries.

## Context
- Exists: `issueCode` (AUTH-002); the challenge with the latest `created_at` for a (target, purpose) is the current one.
- Adds: `verifyCode({ target, purpose, code })` returning `{ challengeId, personId }`.
- Order: no challenge, or consumed -> 400 `OTP_INVALID`; expired -> 400 `OTP_EXPIRED`; already 5 attempts -> 429 `OTP_LOCKED`; wrong code -> attempts + 1 and 400 `OTP_INVALID`; right code -> set `consumed_at`.
- Attempts and consumption are single SQL updates (`UPDATE ... WHERE attempts < 5` and `WHERE consumed_at IS NULL`), so parallel calls cannot exceed 5 tries or use a code twice.
- `CM-06`: A code expires 10 minutes after sending and works once.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.

## Acceptance criteria
```gherkin
Scenario: AC-1 Right code
  When verifyCode receives the right code within 10 minutes
  Then it returns the challenge id and person id and `consumed_at` is set
Scenario: AC-2 Single use
  When the same right code is verified a second time
  Then the result is 400 `OTP_INVALID`
Scenario: AC-3 Expiry
  When the right code is verified after `expires_at`
  Then the result is 400 `OTP_EXPIRED` and the challenge is not consumed
Scenario: AC-4 Attempts
  When five wrong codes are sent, then the right code
  Then the first five answer 400 `OTP_INVALID`, the sixth try answers 429 `OTP_LOCKED`, and the row shows attempts 5 and no `consumed_at`
Scenario: AC-5 Newest code only
  Given two codes issued for one target and purpose
  When the older code is verified
  Then the result is 400 `OTP_INVALID`
```

## Abuse cases
```gherkin
Scenario: AB-1 Guessing a code (spoofing)
  When 1000 wrong codes are sent in parallel
  Then at most 5 are counted, the rest answer 429, and the challenge stays unconsumed
Scenario: AB-2 Parallel use of one right code (tampering)
  When the right code is verified twice at the same time
  Then exactly one call succeeds
```

## Implementation
- Create: `tests/integration/auth/otp-verify.test.ts`
- Modify: `src/modules/auth/otp.service.ts`, `src/modules/auth/otp.repository.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Signatures:
  - `verifyCode(input: { target: string; purpose: OtpPurpose; code: string }): Promise<{ challengeId: string; personId: string | null }>`
- Errors: `OTP_INVALID` 400, `OTP_EXPIRED` 400, `OTP_LOCKED` 429
- Dependencies: `argon2`, `@prisma/client`

## Security
- v5.0.0-6.5.3: a code works once; consumption is an atomic conditional update.
- v5.0.0-6.6.3: 5 attempts per code, counted atomically.
- v5.0.0-2.3.4: attempts and consumption use `WHERE` guards, not read-then-write.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| right code | integration | AC-1 | verify → ids returned, consumed_at set |
| single use | integration | AC-2, CM-06 | second verify → OTP_INVALID |
| expiry | integration | AC-3, CM-06 | after expiry → OTP_EXPIRED, not consumed |
| attempts | integration | AC-4, C-33 | 5 wrong then right → 5 invalid then OTP_LOCKED, attempts 5 |
| newest only | integration | AC-5 | older code → OTP_INVALID |
| guessing | security | AB-1, WSTG-ATHN-03, CWE-307 | 1000 parallel wrong codes → attempts 5, the rest 429 |
| parallel use | security | AB-2, CWE-362 | two parallel right codes → one success |

Command: `npx vitest run tests/integration/auth/otp-verify.test.ts`

## Out of scope
- Endpoints that call it (AUTH-011 onward).
