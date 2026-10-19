---
id: REL-026
title: Relationship answers document the photo of a person
module: relationship
kind: change
rev: 1
amends: [REL-007, REL-008, REL-016, REL-020, REL-021]
size: XS
risk: medium
depends_on: [PER-011, REL-020, REL-021]
read_first: [src/modules/relationship/relationship.openapi.ts, src/modules/relationship/relationship.visibility.ts]
design_refs: [relations-commerciales/customerrelationship/invitation-d-un-fournisseur-par-un, relations-commerciales/customerrelationship/entree-en-relation-le-numero-comme]
constraints: [CM-20]
asvs: [v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# REL-026 — Relationship answers document the photo of a person

## Story
As a customer, I want the supplier I invite by phone number to show a photo when they are registered so that I invite the seller and not the boss.

## Context
- Exists: since PER-011, `toPublicPerson` returns `avatar_url`, and every relationship view reaches a person through it (`customerOf` and `supplierOf` in `relationship.visibility.ts`). The answers already carry the address.
- Missing: the response document. `publicPersonSchema` in `relationship.openapi.ts` lists `public_name`, `phone_number` and `registered`; the supplier-side view, the customer-side view and the list of supplier invitations all use it.
- Change: add `avatar_url`, a string or null, to that one schema. No route, handler or other file changes.
- The 201 answer of `POST /api/v1/suppliers/invitations` shows `public_name` and `avatar_url` of a registered person, so the customer recognizes the seller before sending the invitation from their own phone. A new number shows `registered` false and both null.
- The raw key never leaves: the view holds the address, not `avatar_key`.
- `CM-20`: An organization receives from a person only the public name, the profile photo address, the number and whether they are registered.
- `CM-20`: An organization receives from a person only the public name, the profile photo address, the number and whether they are registered.

## Acceptance criteria
```gherkin
Scenario: AC-1 A registered supplier shows name and photo
  Given a registered person "Paul Mbarga" with a photo key
  When a customer invites their number
  Then the response is 201
  And supplier.person has public_name "Paul Mbarga", registered true and avatar_url equal to the address of the key
Scenario: AC-2 A new number shows no photo
  When a customer invites a number nobody has registered
  Then supplier.person has public_name null, registered false and avatar_url null
Scenario Outline: AC-3 Every answer that shows a person carries the address
  Given the other party of the relationship is a registered person with a photo
  When <caller> calls <route>
  Then each person object has exactly public_name, phone_number, registered and avatar_url
  Examples:
    | caller   | route                                                 |
    | seller   | GET /api/v1/organizations/{organizationId}/customers  |
    | customer | GET /api/v1/suppliers                                 |
    | supplier | GET /api/v1/supplier-invitations                      |
Scenario: AC-4 The documents list the address
  When GET /api/v1/docs/openapi.json is read
  Then the person object of the three answers lists avatar_url, a string or null
```

## Abuse cases
```gherkin
Scenario: AB-1 The stored key leaks (information disclosure)
  When the three answers are read for a person with a photo
  Then no body contains `avatar_key` or the key without its base address
Scenario: AB-2 A stranger sees the photo (access control)
  Given a registered person with a photo, customer of business A
  When a seller of business B lists their customers
  Then the person and the address are absent
```

## Implementation
- Create: `tests/integration/relationship/person-photo.test.ts`
- Modify: `src/modules/relationship/relationship.openapi.ts`
- Pattern: `tests/integration/relationship/default-counter.test.ts`
- Signatures:
  - `publicPersonSchema: z.object({ public_name, phone_number, registered, avatar_url: z.string().nullable() }) in relationship.openapi.ts`
- Dependencies: `@asteasolutions/zod-to-openapi`, `zod`

## Security
- v5.0.0-8.2.3: the person in every answer comes from the four-field public view, never from the stored row.
- v5.0.0-15.3.1: the document lists the four fields, so a client generated from it knows the address and nothing more.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| registered supplier | integration | AC-1, CM-20 | invite a registered person with a key → 201, public_name and avatar_url set |
| new number | integration | AC-2 | invite an unknown number → registered false, avatar_url null |
| three answers | integration | AC-3 | each Examples row → person objects with exactly four keys |
| document | integration | AC-4 | openapi.json → the three person objects list avatar_url, string or null |
| no raw key | security | AB-1, CWE-200 | the three bodies hold no `avatar_key` and no bare key |
| stranger | security | AB-2, WSTG-ATHZ-02 | seller of another business lists customers → person and address absent |

Command: `npx vitest run tests/integration/relationship tests/integration/api-docs`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/relationship/visibility.test.ts | the person view key lists | already changed by PER-011; this story only documents them |

## Out of scope
- Uploading a photo (IMG-003) and the profile view (PER-012).
- The contacts of a business: customers and suppliers receive them by synchronization, not through these answers.
- The name and photo shown by a lookup before any invitation exists: `GET /api/v1/people/lookup` does that (PER-011).
- The response documents of the other modules that show a person: their own stories.
