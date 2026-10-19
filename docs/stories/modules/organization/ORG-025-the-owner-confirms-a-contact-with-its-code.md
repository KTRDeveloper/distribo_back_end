---
id: ORG-025
title: The owner confirms a contact with its code
module: organization
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ORG-024]
read_first: [src/modules/organization/organization-contact.service.ts, tests/integration/organization/contact-add.test.ts]
design_refs: [identite-et-organisation/organizationcontact, acces-et-securite/otpchallenge]
constraints: [C-44, C-33]
asvs: [v5.0.0-6.6.3, v5.0.0-8.2.1]
---

# ORG-025 — The owner confirms a contact with its code

## Story
As an owner, I want to enter the code sent to a contact so that it is published and customers can find my business with it.

## Context
- Exists: contacts and `addContact` (ORG-024); `verifyCode` with a contact id (ORG-041).
- Route `POST /api/v1/organizations/{organizationId}/contacts/{contactId}/confirm`, body (strict) `{ id: UUIDv7, code: 6 digits }`. OWNER, online.
- The contact must be live, of this business and pending; otherwise 404 NOT_FOUND, or 409 CONTACT_ALREADY_VERIFIED for a verified one (no code is consumed).
- `verifyCode({ target: contact.value, purpose: 'ORG_CONTACT_VERIFICATION', code, organizationContactId })`; its errors pass through (400 OTP_INVALID, 400 OTP_EXPIRED, 429 OTP_LOCKED).
- On success one guarded UPDATE sets `verified_at` (server time) and `verification_method` CODE where the contact is still pending and live; no row changed means 404. Response 200 with the contact view of ORG-024.
- Add the path to `organization.openapi.ts` and to the two route lists in the tests.
- `C-44`: `OrganizationContact` is written by the owner only, online; `verified_at` and `verification_method` are set by the server.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, to the administrator's recovery address, or, for ORG_CONTACT_VERIFICATION, to the email of the contact being verified, except for EMAIL_VERIFICATION; `organization_contact_id` is set if and only if `purpose = ORG_CONTACT_VERIFICATION`, and then `target` equals the contact's value.

## Acceptance criteria
```gherkin
Scenario: AC-1 The right code publishes the contact
  Given a pending contact and its code
  When the owner confirms
  Then the answer is 200 with `verified_at` set and `verification_method` CODE
Scenario Outline: AC-2 Refusals
  When the owner confirms with <case>
  Then the answer is <status> <code>, and the contact stays pending
  Examples:
    | case                              | status | code                      |
    | a wrong code                      | 400    | OTP_INVALID               |
    | an expired code                   | 400    | OTP_EXPIRED               |
    | a contact already verified        | 409    | CONTACT_ALREADY_VERIFIED  |
    | a deleted contact                 | 404    | NOT_FOUND                 |
    | a contact of another business     | 404    | NOT_FOUND                 |
Scenario: AC-3 A repeat changes nothing
  When the same request with the same `id` is sent twice
  Then the second answer equals the first
Scenario: AC-4 Only the owner
  When a MANAGER sends the request
  Then the answer is 403 FORBIDDEN
```

## Abuse cases
```gherkin
Scenario: AB-1 A guessed code publishes a number (spoofing)
  When the owner sends six wrong codes for the same contact, then the right one
  Then the sixth is 429 OTP_LOCKED and the contact stays pending
Scenario: AB-2 The code of another contact is used (spoofing)
  Given the same number is pending for two businesses and a code was issued for the first
  When the owner of the second sends that code for the second contact
  Then the answer is 400 OTP_INVALID and the second contact stays pending
```

## Implementation
- Create: `tests/integration/organization/contact-confirm.test.ts`
- Modify: `src/modules/organization/organization-contact.service.ts`, `src/modules/organization/organization-contact.repository.ts`, `src/modules/organization/organization-contact.schemas.ts`, `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/middleware/idempotent.ts`
- Signatures:
  - `confirmContact(actor: Actor, contactId: string, code: string): Promise<ContactView>`
  - `markContactVerified(contactId: string, organizationId: string, now: Date): Promise<ContactRow | null>`
- Errors: `OTP_INVALID` 400, `OTP_EXPIRED` 400, `OTP_LOCKED` 429, `CONTACT_ALREADY_VERIFIED` 409, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: none added

## Security
- v5.0.0-6.6.3: five attempts at most, one use, and the code belongs to this contact.
- v5.0.0-8.2.1: only the OWNER of the business confirms, and the contact must belong to it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| right code | integration | AC-1, C-44 | 200, verified_at set, CODE |
| refusals | integration | AC-2 | each Examples row → status, code, still pending |
| repeat | integration | AC-3 | same id twice → same body |
| non-owner | integration | AC-4 | MANAGER → 403 |
| lock | security | AB-1, CWE-307 | six wrong then right → 429 OTP_LOCKED, pending |
| other contact | security | AB-2, C-33 | code of A for B → 400, B pending |

Command: `npx vitest run tests/integration/organization/contact-confirm.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

## Out of scope
- Issuing and resending a code (ORG-024, ORG-026).
