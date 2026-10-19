---
id: ORG-027
title: The owner deletes a public contact
module: organization
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ORG-024]
read_first: [src/modules/organization/organization-contact.service.ts, tests/integration/organization/contact-add.test.ts]
design_refs: [identite-et-organisation/organizationcontact, synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone]
constraints: [C-35, C-44]
asvs: [v5.0.0-8.2.1, v5.0.0-8.3.1]
---

# ORG-027 — The owner deletes a public contact

## Story
As an owner, I want to delete a public contact so that my business is no longer found by it and its place is free.

## Context
- Exists: contacts and `addContact` (ORG-024); the OWNER delete row (ORG-040).
- Route `DELETE /api/v1/organizations/{organizationId}/contacts/{contactId}`, no body, answer 204. OWNER, online. Like the other delete routes, it carries no `id`; a second delete answers 404.
- The contact must be live and of this business, else 404 NOT_FOUND. The row is not removed: `deleted_at` is set, so telephones learn the deletion; the database sets `server_updated_at` (C-35).
- A verified contact stops being published at once; its place (slot or email) is free for a new contact, which starts pending.
- A contact is never edited: no PATCH or PUT route exists for it.
- Add the path to `organization.openapi.ts` and to the two route lists in the tests.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.
- `C-44`: `OrganizationContact` is written by the owner only, online; `verified_at` and `verification_method` are set by the server.

## Acceptance criteria
```gherkin
Scenario: AC-1 The contact is deleted
  Given a verified contact
  When the owner deletes it
  Then the answer is 204, `deleted_at` is set and `findOrganizationsByPublicNumber` no longer returns the business for that number
Scenario: AC-2 The place is free
  When the owner then adds a new contact in the same slot
  Then the answer is 201 and the new contact is pending
Scenario Outline: AC-3 Refusals
  When the owner deletes <case>
  Then the answer is 404 NOT_FOUND
  Examples:
    | case                           |
    | an unknown contact             |
    | a contact already deleted      |
    | a contact of another business  |
Scenario: AC-4 No edit route
  When a PATCH or a PUT is sent to the contact path
  Then the answer is 404 NOT_FOUND
```

## Abuse cases
```gherkin
Scenario: AB-1 A manager removes the contacts (elevation)
  When a MANAGER, a SELLER or a DRIVER sends the request
  Then the answer is 403 FORBIDDEN and the contact is untouched
```

## Implementation
- Create: `tests/integration/organization/contact-delete.test.ts`
- Modify: `src/modules/organization/organization-contact.service.ts`, `src/modules/organization/organization-contact.repository.ts`, `src/modules/organization/organization-contact.schemas.ts`, `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/middleware/require-ability.ts`
- Signatures:
  - `deleteContact(actor: Actor, contactId: string): Promise<void>`
  - `softDeleteContact(contactId: string, organizationId: string, now: Date): Promise<boolean>`
- Errors: `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: none added

## Security
- v5.0.0-8.2.1: only the OWNER of the business, online, deletes a contact.
- v5.0.0-8.3.1: the contact must belong to the business of the session, else 404.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| delete | integration | AC-1, C-35 | 204, deleted_at set, number no longer finds the business |
| place free | integration | AC-2, C-35 | same slot added again → 201 pending |
| refusals | integration | AC-3 | each Examples row → 404 |
| no edit | integration | AC-4, C-44 | PATCH and PUT → 404 |
| non-owner | security | AB-1, CWE-285 | MANAGER, SELLER, DRIVER → 403, contact untouched |

Command: `npx vitest run tests/integration/organization/contact-delete.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

## Out of scope
- Listing contacts: they arrive by synchronization (SYNC).
