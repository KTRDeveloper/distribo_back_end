---
id: ORG-024
title: The owner adds a public phone number to the business
module: organization
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORG-021, ORG-040, ORG-041, PER-001]
read_first: [src/middleware/idempotent.ts, tests/integration/organization/invite.test.ts]
design_refs: [identite-et-organisation/organizationcontact, acces-et-securite/otpchallenge]
constraints: [C-43, C-44]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# ORG-024 — The owner adds a public phone number to the business

## Story
As an owner, I want to add a phone number as a public contact so that customers can find and reach my business.

## Context
- Exists: `loadActor`, `requireAbility`, `idempotent`, `assertOrganizationActive` (ORG-005); the OWNER rule row (ORG-040); `issueCode` with a contact (ORG-041); `findByActivePhone` (person repository).
- Route `POST /api/v1/organizations/{organizationId}/contacts`, body (strict) `{ id: UUIDv7, kind: 'PHONE', slot: 1..3, value }`; `value` goes through `phoneNumberSchema`.
- The owner's own active number, with `phone_verified_at` set, is stored verified at once (`verified_at` now, `verification_method` OWNER_PHONE, no code). Any other number is stored pending and `issueCode` sends it a code by SMS.
- Pending contacts count in the limit of three (ORG-021); a request that loses a race (23505) is answered like the pre-check.
- If the code cannot be sent (429 OTP_RATE_LIMITED), the contact stays pending and the answer is that 429: the owner resends (ORG-026).
- Response 201 with `ContactView`. No list or edit route exists: contacts arrive by synchronization.
- Add the path to `organization.openapi.ts` and to the route lists in `tests/integration/api-docs/catalog.test.ts` and `per-001.test.ts`.
- `C-43`: `OrganizationContact`: `slot` is set exactly when `kind = PHONE` and is between 1 and 3, unique per (`organization_id`, `slot`); at most one EMAIL per organization (partial unique index); unique per (`organization_id`, `value`); a PHONE `value` is in E.164 format; `verification_method` is set exactly when `verified_at` is set; all these uniqueness rules ignore deleted rows.
- `C-44`: `OrganizationContact` is written by the owner only, online; `verified_at` and `verification_method` are set by the server.

## Acceptance criteria
```gherkin
Scenario: AC-1 The owner's own number is verified at once
  Given the owner's active number is verified
  When they add it
  Then the answer is 201 with `verification_method` OWNER_PHONE and no code is sent
Scenario: AC-2 Another number waits for a code
  When the owner adds a Cameroon mobile number that is not theirs
  Then the answer is 201 with `verified_at` null and one SMS code tied to this contact is sent
Scenario Outline: AC-3 Refusals
  When the owner adds <case>
  Then the answer is <status> <code>
  Examples:
    | case                                   | status | code                   |
    | a taken slot, or a fourth number       | 409    | CONTACT_SLOT_TAKEN     |
    | a number already listed                | 409    | CONTACT_ALREADY_EXISTS |
    | a number that is not a Cameroon mobile | 400    | UNSUPPORTED_NUMBER     |
    | an unknown field, or no slot           | 400    | VALIDATION_ERROR       |
    | a closed or suspended business         | 409    | ORGANIZATION_NOT_ACTIVE |
Scenario: AC-4 A repeat changes nothing
  When the same request with the same `id` is sent twice
  Then the second answer equals the first, with one contact
```

## Abuse cases
```gherkin
Scenario: AB-1 Someone else's number is published without proof (spoofing)
  When the owner adds a number that is not theirs and never enters a code
  Then `verified_at` stays null and the number does not find the business
Scenario: AB-2 A manager adds a contact (elevation)
  When a MANAGER, a SELLER or a DRIVER of the business sends the request
  Then the answer is 403 FORBIDDEN and nothing is stored or sent
```

## Implementation
- Create: `src/modules/organization/organization-contact.repository.ts`, `src/modules/organization/organization-contact.service.ts`, `src/modules/organization/organization-contact.schemas.ts`, `tests/integration/organization/contact-add.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/middleware/idempotent.ts`
- Signatures:
  - `addContact(actor: Actor, input: AddContactInput): Promise<ContactView>`
- Types:
  - `ContactView = { id; kind: 'PHONE' | 'EMAIL'; slot: number | null; value; verified_at: string | null; verification_method: 'CODE' | 'OWNER_PHONE' | null; created_at }`
- Errors: `CONTACT_SLOT_TAKEN` 409, `CONTACT_ALREADY_EXISTS` 409, `UNSUPPORTED_NUMBER` 400, `ORGANIZATION_NOT_ACTIVE` 409, `FORBIDDEN` 403, `VALIDATION_ERROR` 400
- Dependencies: `zod`

## Security
- v5.0.0-8.2.1: only the OWNER, online, reaches the route.
- v5.0.0-15.3.3: the server sets `verified_at`, `verification_method` and `created_by_id`; the body holds `id`, `kind`, `slot`, `value` only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| own number | integration | AC-1, C-44 | 201, OWNER_PHONE, no job queued |
| other number | integration | AC-2, C-43 | pending, one SMS job tied to the contact |
| refusals | integration | AC-3, C-43 | each Examples row → status and code |
| repeat | integration | AC-4 | same id twice → same body, one row |
| not proven | security | AB-1, CWE-290 | stays pending: no lookup by that number finds the business |
| non-owner | security | AB-2, CWE-285 | MANAGER, SELLER, DRIVER → 403, no row |

Command: `npx vitest run tests/integration/organization/contact-add.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

## Out of scope
- The email (ORG-042); confirming, resending and deleting (ORG-025 to ORG-027); the lookup by contact (ORG-029).
- Contacts in the creation body (the owner adds them afterwards) and keeping the old number when the owner changes theirs: open questions.
