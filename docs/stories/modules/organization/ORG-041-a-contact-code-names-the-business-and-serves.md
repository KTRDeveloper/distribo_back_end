---
id: ORG-041
title: A contact code names the business and serves one contact
module: organization
kind: change
rev: 1
amends: [AUTH-002, AUTH-003]
size: S
risk: high
depends_on: [ORG-023, AUTH-003]
read_first: [src/modules/auth/otp.service.ts, tests/integration/auth/otp-issue.test.ts]
design_refs: [acces-et-securite/otpchallenge, identite-et-organisation/organizationcontact]
constraints: [C-33]
asvs: [v5.0.0-6.6.3]
---

# ORG-041 — A contact code names the business and serves one contact

## Story
Technical story: let issueCode and verifyCode work on one contact of a business, with the fixed text that names the business, so that a code given for one contact cannot confirm another.

## Context
- Exists: `issueCode`, `verifyCode` in `src/modules/auth/otp.service.ts`; `findLatest(target, purpose)` and the type `OtpPurpose` in `otp.repository.ts`; the column from ORG-023.
- `IssueCodeInput` gains `contact?: { id: string; organizationName: string }`: required with the purpose ORG_CONTACT_VERIFICATION, refused with any other (an `Error`, a programming mistake, never user input). The row keeps the contact id. The language is the one of `personId`, the owner.
- The text is fixed. FR: `Code 482913. Boutique Fotso veut afficher ce numéro comme contact sur Distribo. Ne donnez ce code que si vous acceptez.` EN: `Code 482913. Boutique Fotso wants to show this number as a contact on Distribo. Only give this code if you agree.` For an email, "ce numéro" becomes "cette adresse" and "this number" "this address" (open question).
- The business name is cleaned: control characters removed, cut at 40 characters, so a name cannot add lines or a second message.
- `verifyCode` takes `organizationContactId`, and `findLatest` filters by it when given. Refused with 400 OTP_INVALID: the purpose without the id, or another purpose with one.
- This ships before its first use (ORG-024, ORG-025).
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, to the administrator's recovery address, or, for ORG_CONTACT_VERIFICATION, to the email of the contact being verified, except for EMAIL_VERIFICATION; `organization_contact_id` is set if and only if `purpose = ORG_CONTACT_VERIFICATION`, and then `target` equals the contact's value.

## Acceptance criteria
```gherkin
Scenario: AC-1 The text names the business
  When issueCode runs for a contact of "Boutique Fotso" by SMS
  Then the queued message is the fixed text with the 6-digit code, in French or English
  And the challenge row keeps the contact id
Scenario: AC-2 The name is cleaned
  When the business name holds a line break and 60 characters
  Then the message holds no control character and 40 characters of the name
Scenario: AC-3 A code serves one contact
  Given two contacts show the same number and a code was issued for the first
  When verifyCode is called with the second contact id and the right code
  Then it throws 400 OTP_INVALID
  And with the first contact id it succeeds
Scenario: AC-4 Wrong pairing
  When verifyCode is called for ORG_CONTACT_VERIFICATION without an id, or for LOGIN with one
  Then it throws 400 OTP_INVALID
Scenario: AC-5 Other purposes unchanged
  When the tests of otp-issue and otp-verify run
  Then they pass as before
```

## Abuse cases
```gherkin
Scenario: AB-1 A code given for one business confirms another (spoofing)
  Given the same number is a pending contact of two businesses
  When the code issued for business A is entered for the contact of business B
  Then it is refused and B stays pending
```

## Implementation
- Create: `tests/integration/auth/otp-contact-code.test.ts`
- Modify: `src/modules/auth/otp.service.ts`, `src/modules/auth/otp.repository.ts`
- Pattern: `tests/integration/auth/otp-issue.test.ts`
- Signatures:
  - `issueCode(input: IssueCodeInput, clientKeys?: ClientKeys): Promise<{ challengeId: string; expiresAt: Date }>`
  - `verifyCode(input: { target: string; purpose: OtpPurpose; code: string; organizationContactId?: string }): Promise<{ challengeId: string; personId: string | null }>`
  - `contactCodeMessage(code: string, language: 'FR' | 'EN', organizationName: string, channel: 'SMS' | 'EMAIL'): string`
- Types:
  - `OtpPurpose gains 'ORG_CONTACT_VERIFICATION'`
- Errors: `OTP_INVALID` 400
- Dependencies: `@prisma/client`

## Security
- v5.0.0-6.6.3: a code stays limited to 5 attempts and one use, and is now tied to one contact.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| fixed text | integration | AC-1 | message equals the French and the English text; row has the contact id |
| clean name | unit | AC-2 | line break removed, name of 60 characters cut to 40 |
| one contact | integration | AC-3, C-33 | code of A with the id of B → 400 OTP_INVALID; with the id of A → success |
| wrong pairing | integration | AC-4 | both cases → 400 OTP_INVALID |
| others unchanged | integration | AC-5 | otp-issue and otp-verify pass |
| cross-business code | security | AB-1, CWE-345 | code of A entered for B → refused, B stays pending |

Command: `npx vitest run tests/integration/auth/otp-contact-code.test.ts tests/integration/auth/otp-issue.test.ts tests/integration/auth/otp-verify.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth/otp-issue.test.ts | line 53 matches the French text of a code sent for another purpose | unchanged |
| tests/integration/auth/otp-verify.test.ts | verifies codes without a contact id for other purposes | unchanged: the id is refused only for another purpose than ORG_CONTACT_VERIFICATION |

## Out of scope
- The routes that issue and confirm contact codes (ORG-024, ORG-025, ORG-026).
- The purpose ACCESS_RESTORE in the TypeScript type: it ships with the administrator story that uses it.
