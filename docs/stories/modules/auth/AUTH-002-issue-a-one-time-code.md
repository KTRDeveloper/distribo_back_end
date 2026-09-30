---
id: AUTH-002
title: Issue a one-time code
module: auth
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [AUTH-001, FND-004, FND-006, NTF-002]
read_first: [src/lib/otp.ts, src/lib/otp-delivery-queue.ts]
design_refs: [acces-et-securite/otpchallenge]
constraints: [CM-06, CM-07, C-33]
asvs: [v5.0.0-6.5.4, v5.0.0-6.6.1, v5.0.0-2.4.1, v5.0.0-11.4.2]
---

# AUTH-002 — Issue a one-time code

## Story
Technical story: create and send a one-time code with the sending limits, so that no flow can flood a phone or the SMS budget.

## Context
- Exists: `generateOtp`, `hashOtp` (bcrypt) in `src/lib/otp.ts`; `enqueueOtpDelivery({ channel, to, message, subject? })`; `checkAndConsume(key, limit, windowSeconds)` in `src/lib/rate-limit.ts`; `otp_challenges` (AUTH-001); `isCameroonMobile`.
- Adds: `src/modules/auth/otp.repository.ts` and `otp.service.ts` with `issueCode`; `hashOtp` and `verifyOtp` in `src/lib/otp.ts` now use Argon2id (`argon2`) with memory 19456 KiB, time 2, parallelism 1.
- `issueCode`: refuse a SMS target that is not a Cameroon mobile (400 `UNSUPPORTED_NUMBER`); allow 3 codes per hour per target (key `otp:hour:<target>`) and one per 60 seconds per target and purpose (key `otp:cooldown:<purpose>:<target>`), else 429 `OTP_RATE_LIMITED`; store a 6-digit code as a hash valid 10 minutes; queue the message.
- Message text: French "Votre code Distribo : <code>. Il expire dans 10 minutes." or English "Your Distribo code: <code>. It expires in 10 minutes." from `recipientLanguage` when the person is known, else French. Email codes carry subject "Distribo".
- `CM-06`: A code expires 10 minutes after sending and works once.
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.

## Acceptance criteria
```gherkin
Scenario: AC-1 Code issued and queued
  When issueCode is called for a Cameroon number with purpose LOGIN
  Then one challenge exists with a hash, `expires_at` 10 minutes ahead, attempts 0
  And one delivery job is queued to that number whose message contains the 6-digit code
Scenario Outline: AC-2 Sending limits
  Given <history>
  When issueCode is called
  Then the result is <result>
  Examples:
    | history                                       | result                          |
    | no code sent                                  | issued                          |
    | one code sent 30 seconds ago, same purpose    | 429 OTP_RATE_LIMITED            |
    | one code sent 61 seconds ago, same purpose    | issued                          |
    | three codes sent in the last hour             | 429 OTP_RATE_LIMITED            |
Scenario: AC-3 Foreign numbers refused
  When the target is +33612345678 with channel SMS
  Then the result is 400 `UNSUPPORTED_NUMBER`, nothing is stored and nothing is queued
Scenario: AC-4 No plain code stored
  Then the stored hash is an Argon2id string and never equals the code
```

## Abuse cases
```gherkin
Scenario: AB-1 SMS pumping (denial of service)
  When a bot requests codes for 100 different foreign numbers
  Then no SMS is queued
Scenario: AB-2 Code in logs (information disclosure)
  When a code is issued
  Then no log entry contains the code or the target
```

## Implementation
- Create: `src/modules/auth/otp.repository.ts`, `src/modules/auth/otp.service.ts`, `tests/integration/auth/otp-issue.test.ts`
- Modify: `src/lib/otp.ts`
- Pattern: `src/modules/tasks/tasks.repository.ts`
- Signatures:
  - `issueCode(input: IssueCodeInput): Promise<{ challengeId: string; expiresAt: Date }>`
- Types:
  - `OtpPurpose = 'REGISTRATION' | 'LOGIN' | 'PASSWORD_RESET' | 'PHONE_CHANGE' | 'EMAIL_VERIFICATION' | 'TOTP_RECOVERY'`
  - `IssueCodeInput = { personId: string | null; target: string; purpose: OtpPurpose; channel: 'SMS' | 'EMAIL' }`
- Errors: `OTP_RATE_LIMITED` 429, `UNSUPPORTED_NUMBER` 400
- Dependencies: `argon2`, `ioredis`, `bullmq`, `@prisma/client`

## Security
- v5.0.0-6.5.4: codes are 6 digits from `crypto.randomInt`.
- v5.0.0-6.6.1: SMS only to +237 mobiles.
- v5.0.0-2.4.1: limits are checked before the row is written and before anything is queued.
- v5.0.0-11.4.2: codes hashed with Argon2id.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| issue | integration | AC-1, CM-06 | LOGIN code → row, 10 minute expiry, queued message has 6 digits |
| limits | integration | AC-2, CM-07 | each Examples row (rate-limit module mocked with a fake clock) → result |
| foreign number | integration | AC-3, C-33 | +33 number → 400, no row, no job |
| hash only | integration | AC-4 | stored hash starts with `$argon2id$` and differs from the code |
| sms pumping | security | AB-1, WSTG-BUSL-07, CWE-770 | 100 foreign targets → 0 jobs |
| no code in logs | security | AB-2, CWE-532 | capture logger output → no code, no number |

Command: `npx vitest run tests/integration/auth/otp-issue.test.ts tests/unit/auth/otp.test.ts`

## Out of scope
- Verifying a code (AUTH-003). Device, IP and daily caps (AUTH-004).
