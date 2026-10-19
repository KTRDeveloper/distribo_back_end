---
id: ORG-042
title: The owner adds a public email to the business
module: organization
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ORG-024]
read_first: [src/modules/organization/organization-contact.service.ts, tests/integration/organization/contact-add.test.ts]
design_refs: [identite-et-organisation/organizationcontact, acces-et-securite/otpchallenge]
constraints: [C-43, C-44]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# ORG-042 — The owner adds a public email to the business

## Story
As an owner, I want to add an email address as a public contact of my business so that customers can write to it.

## Context
- Exists: `addContact`, `ContactView` and the route of ORG-024; `issueCode` with a contact for the channel EMAIL (ORG-041).
- The body accepts `kind: 'EMAIL'` with no `slot` (refused with a slot) and `value`: trimmed, lower case, at most 254 characters, a valid address. The unique rules of ORG-021 give one email.
- An email is never verified at once, even if it is the owner's: it is stored pending and `issueCode` sends the code by email, to the address, with the business name and the contact id. The email is not used to find a business (ORG-029).
- The same answers apply: 201 with the closed list of ORG-024; 409 CONTACT_SLOT_TAKEN for a second email; 409 CONTACT_ALREADY_EXISTS; 400 VALIDATION_ERROR.
- `C-43`: `OrganizationContact`: `slot` is set exactly when `kind = PHONE` and is between 1 and 3, unique per (`organization_id`, `slot`); at most one EMAIL per organization (partial unique index); unique per (`organization_id`, `value`); a PHONE `value` is in E.164 format; `verification_method` is set exactly when `verified_at` is set; all these uniqueness rules ignore deleted rows.
- `C-44`: `OrganizationContact` is written by the owner only, online; `verified_at` and `verification_method` are set by the server.

## Acceptance criteria
```gherkin
Scenario: AC-1 An email waits for a code
  When the owner adds `Shop@Example.cm`
  Then the answer is 201 with value `shop@example.cm`, `slot` null and `verified_at` null
  And one email code tied to this contact is sent to that address
Scenario: AC-2 The owner's own email is not trusted
  Given the owner's verified email is `owner@example.cm`
  When they add it
  Then it is pending and a code is sent
Scenario Outline: AC-3 Refusals
  When the owner adds <case>
  Then the answer is <status> <code>
  Examples:
    | case                           | status | code                   |
    | a second email                 | 409    | CONTACT_SLOT_TAKEN     |
    | the same address, written in capitals  | 409    | CONTACT_ALREADY_EXISTS |
    | not-an-address                 | 400    | VALIDATION_ERROR       |
    | an email with a slot           | 400    | VALIDATION_ERROR       |
```

## Abuse cases
```gherkin
Scenario: AB-1 Someone else's address is published without proof (spoofing)
  When the owner adds an address that is not theirs and never enters a code
  Then `verified_at` stays null
```

## Implementation
- Create: `tests/integration/organization/contact-add-email.test.ts`
- Modify: `src/modules/organization/organization-contact.service.ts`, `src/modules/organization/organization-contact.schemas.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/middleware/idempotent.ts`
- Errors: `CONTACT_SLOT_TAKEN` 409, `CONTACT_ALREADY_EXISTS` 409, `VALIDATION_ERROR` 400
- Dependencies: `zod`

## Security
- v5.0.0-8.2.1: the owner-only rule of the route is unchanged.
- v5.0.0-15.3.3: the body lists `id`, `kind`, `slot` and `value` only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| email | integration | AC-1, C-43 | lower case stored, pending, one EMAIL job |
| own email | integration | AC-2, C-44 | pending, code sent |
| refusals | integration | AC-3, C-43 | each Examples row → status and code |
| not proven | security | AB-1, CWE-290 | pending forever |

Command: `npx vitest run tests/integration/organization/contact-add-email.test.ts tests/integration/organization/contact-add.test.ts`

## Out of scope
- Confirming, resending and deleting (ORG-025, ORG-026, ORG-027).
