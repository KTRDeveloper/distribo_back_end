---
id: ADM-018
title: The access-restore code has its fixed text
module: admin
kind: change
rev: 1
amends: [AUTH-002, ORG-041]
size: XS
risk: medium
depends_on: [ORG-041, AUTH-027]
read_first: [src/modules/auth/otp.service.ts, tests/integration/auth/otp-issue.test.ts]
design_refs: [acces-et-securite/otpchallenge]
constraints: [CM-40]
asvs: [v5.0.0-6.6.2, v5.0.0-16.2.5]
---

# ADM-018 — The access-restore code has its fixed text

## Story
Technical story: give the codes of the access restoration their own fixed text, so that the person is told to give them only to the support agent they contacted.

## Context
- Exists: `messageFor` in `otp.service.ts` builds the text of a code from the code and the language; ORG-041 gives the contact purpose its own text. The purpose ACCESS_RESTORE exists (AUTH-027) and nothing issues it yet.
- `messageFor` also takes the purpose. For ACCESS_RESTORE, by SMS and by email alike, FR: `Code 482913. Ne le donnez qu'à l'agent du support que vous avez contacté vous-même.` EN: `Code 482913. Only give it to the support agent you contacted yourself.` There is no expiry sentence. The language is the one of `personId`.
- Every other purpose keeps its text. This ships before its first use (ADM-019).
- `CM-40`: Access restored by support (RESTORE_ACCESS, super administrators only) needs a verified email, a code sent to that email and a code sent to the new number (purpose ACCESS_RESTORE). The number is replaced like a number change (PhoneNumberChangeLog), every device is signed out and the person is notified. Without a verified email support can do nothing.

## Acceptance criteria
```gherkin
Scenario: AC-1 The fixed text in French and in English
  Given a person whose language is FR, then one whose language is EN
  When issueCode runs with the purpose ACCESS_RESTORE, by SMS and by email
  Then each queued message is the fixed text of its language with the 6-digit code
Scenario: AC-2 Other purposes unchanged
  When issueCode runs with the purpose REGISTRATION
  Then the queued message is the text it had before
```

## Abuse cases
```gherkin
Scenario: AB-1 The message carries personal data (information disclosure)
  When a code is issued for ACCESS_RESTORE
  Then the message holds only the code and the fixed sentence, no name, email or number
```

## Implementation
- Create: `tests/integration/auth/otp-access-restore-text.test.ts`
- Modify: `src/modules/auth/otp.service.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `messageFor(code: string, language: 'FR' | 'EN', purpose: OtpPurpose): string`
- Dependencies: none added

## Security
- v5.0.0-6.6.2: the text tells the person that the code serves one conversation with the support agent.
- v5.0.0-16.2.5: the message carries no personal data and the log never holds the code.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| fixed text | integration | AC-1, CM-40 | FR and EN, SMS and email → the fixed message with the code |
| other purposes | integration | AC-2 | REGISTRATION → the earlier text |
| no personal data | security | AB-1, CWE-200 | the ACCESS_RESTORE message holds only the code and the sentence |

Command: `npx vitest run tests/integration/auth/otp-access-restore-text.test.ts tests/integration/auth/otp-issue.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth/otp-issue.test.ts | line 53 matches the French text of a code sent for another purpose | unchanged: every purpose other than ACCESS_RESTORE keeps its text |

## Out of scope
- Issuing the codes: ADM-019.
