---
id: ORG-026
title: The owner asks for a contact code again
module: organization
kind: feature
rev: 1
amends: []
size: XS
risk: medium
depends_on: [ORG-025]
read_first: [src/modules/organization/organization-contact.service.ts, tests/integration/organization/contact-confirm.test.ts]
design_refs: [identite-et-organisation/organizationcontact]
constraints: [C-33]
asvs: [v5.0.0-6.6.3, v5.0.0-2.4.1]
---

# ORG-026 — The owner asks for a contact code again

## Story
As an owner, I want the code sent again to a pending contact so that I can confirm it when the first one did not arrive.

## Context
- Exists: `confirmContact` and the contact repository (ORG-025); `issueCode` with a contact (ORG-041), which keeps the sending limits of every code (60 seconds between two codes, 3 per hour per target).
- Route `POST /api/v1/organizations/{organizationId}/contacts/{contactId}/resend`, body (strict) `{ id: UUIDv7 }`. OWNER, online.
- The contact must be live, of this business and pending, else 404 NOT_FOUND; a verified one gives 409 CONTACT_ALREADY_VERIFIED. A new code is issued to the same value and channel; the former codes can no longer be used because the newest one counts.
- Response 200 `{ sent: true, expires_in: 600 }`. A limit hit gives 429 OTP_RATE_LIMITED.
- Add the path to `organization.openapi.ts` and to the two route lists in the tests.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, to the administrator's recovery address, or, for ORG_CONTACT_VERIFICATION, to the email of the contact being verified, except for EMAIL_VERIFICATION; `organization_contact_id` is set if and only if `purpose = ORG_CONTACT_VERIFICATION`, and then `target` equals the contact's value.

## Acceptance criteria
```gherkin
Scenario: AC-1 A new code is sent
  Given a pending contact
  When the owner asks again
  Then the answer is 200 and one more job is queued to the same value
Scenario: AC-2 Limits
  When the owner asks again within 60 seconds
  Then the answer is 429 OTP_RATE_LIMITED and nothing is queued
Scenario Outline: AC-3 Refusals
  When the owner asks for <case>
  Then the answer is <status> <code>
  Examples:
    | case                           | status | code                     |
    | a verified contact             | 409    | CONTACT_ALREADY_VERIFIED |
    | a deleted contact              | 404    | NOT_FOUND                |
    | a contact of another business  | 404    | NOT_FOUND                |
Scenario: AC-4 The old code is dead
  Given a first code and a second code for the same contact
  When the first is entered
  Then the answer is 400 OTP_INVALID
```

## Abuse cases
```gherkin
Scenario: AB-1 A manager triggers messages to a stranger (abuse of sending)
  When a MANAGER sends the request
  Then the answer is 403 FORBIDDEN and nothing is queued
```

## Implementation
- Create: `tests/integration/organization/contact-resend.test.ts`
- Modify: `src/modules/organization/organization-contact.service.ts`, `src/modules/organization/organization-contact.schemas.ts`, `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/middleware/idempotent.ts`
- Signatures:
  - `resendContactCode(actor: Actor, contactId: string): Promise<{ sent: true; expires_in: number }>`
- Errors: `OTP_RATE_LIMITED` 429, `CONTACT_ALREADY_VERIFIED` 409, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: none added

## Security
- v5.0.0-2.4.1: the sending limits of every code apply, so the route cannot flood a number.
- v5.0.0-6.6.3: only the newest code of the contact counts.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| new code | integration | AC-1 | 200, one job to the same value |
| limit | integration | AC-2, C-33 | second call within 60 s → 429, no job |
| refusals | integration | AC-3 | each Examples row → status, code |
| old code | integration | AC-4 | first code after a second → 400 OTP_INVALID |
| non-owner | security | AB-1, CWE-285 | MANAGER → 403, no job |

Command: `npx vitest run tests/integration/organization/contact-resend.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

## Out of scope
- Changing the value of a contact: it is deleted and added again (ORG-027, ORG-024).
