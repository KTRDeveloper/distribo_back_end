---
id: ORG-029
title: A business is found by its verified public contacts
module: organization
kind: change
rev: 1
amends: [ORG-018]
size: XS
risk: high
depends_on: [ORG-018, ORG-021, ORG-037]
read_first: [src/modules/organization/organization.repository.ts, tests/integration/organization/lookup.test.ts]
design_refs: [identite-et-organisation/organizationcontact, identite-et-organisation/organization]
constraints: [CM-26, C-44]
asvs: [v5.0.0-15.3.1, v5.0.0-2.4.1]
---

# ORG-029 — A business is found by its verified public contacts

## Story
As a customer, I want a business to be found by the phone number it has proven so that I reach the right business and nobody else's.

## Context
- Exists: `findOrganizationsByPublicNumber(e164)` (contract PublicContacts, ORG-018) matches an ACTIVE collaborator flagged `is_public_contact` whose current number is `e164`. It serves `GET /api/v1/organizations/lookup` and the supplier invitation of REL (409 `NUMBER_IS_ORGANIZATION`).
- Now it matches the business's own contacts: an ACTIVE, non-deleted organization with a live (`deleted_at` empty) `OrganizationContact` of kind PHONE, `value = e164` and `verified_at` set. The person who holds the number no longer matters.
- Same signature, same three fields (`id`, `name`, `description`), same order and cap (`LOOKUP_RESULT_MAX`), same shared rate limit `lookup:<personId>`. Two businesses holding the same verified number are both listed.
- A pending contact, a deleted one, an EMAIL contact, a SUSPENDED or CLOSED business never match. The flag `is_public_contact` is no longer read here.
- Change only the query. ORG-031 and ORG-032 remove the flag later.
- `CM-26`: Finding an organization by number returns only ACTIVE organizations that have a verified PHONE contact with that number; a number that is not a verified public number of any organization leads to an invitation for every person.
- `C-44`: `OrganizationContact` is written by the owner only, online; `verified_at` and `verification_method` are set by the server.

## Acceptance criteria
```gherkin
Scenario: AC-1 A verified phone contact finds the business
  When someone looks up the number of a verified PHONE contact of an ACTIVE business
  Then the answer lists `id`, `name` and `description` of the business
Scenario Outline: AC-2 Anything else finds nothing
  Given a contact of <case> holding the number
  When someone looks up the number
  Then the answer is 200 with an empty list
  Examples:
    | case                                 |
    | a PHONE contact not yet verified     |
    | a deleted PHONE contact              |
    | a SUSPENDED business                 |
    | a CLOSED business                    |
    | an owner whose own number matches    |
Scenario: AC-3 Two businesses, one number
  When two ACTIVE businesses hold the same verified number
  Then both are listed, newest first
Scenario: AC-4 The supplier invitation still refuses a business number
  When a supplier invitation targets a verified contact number
  Then the answer is 409 NUMBER_IS_ORGANIZATION
```

## Abuse cases
```gherkin
Scenario: AB-1 A number that was never proven puts a business on someone else's number (spoofing, T4)
  Given a business added a stranger's number as a contact and never confirmed it
  When anyone looks up that number
  Then the business is not listed and the stranger's lookups show nothing new
```

## Implementation
- Create: `tests/integration/organization/lookup-contacts.test.ts`
- Modify: `src/modules/organization/organization.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `findOrganizationsByPublicNumber(e164: string): Promise<Array<{ id: string; name: string; description: string | null }>>`
- Dependencies: none added

## Security
- v5.0.0-15.3.1: the query selects three fields and no contact or collaborator data.
- v5.0.0-2.4.1: the shared lookup limit is unchanged.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| verified contact | integration | AC-1, CM-26 | verified PHONE contact → business listed with three fields |
| finds nothing | integration | AC-2, C-44 | each Examples row → empty list |
| two businesses | integration | AC-3 | both listed, newest first |
| supplier invitation | integration | AC-4 | verified contact number → 409 NUMBER_IS_ORGANIZATION |
| never proven | security | AB-1, CWE-290 | pending contact on a stranger's number → not listed |

Command: `npx vitest run tests/integration/organization/lookup-contacts.test.ts tests/integration/organization/lookup.test.ts tests/integration/relationship/invite-supplier.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/lookup.test.ts | the cases seed a public contact as a collaborator with `isPublicContact` and one case expects the business to vanish when its owner releases the number | the cases seed verified PHONE contacts; the released-number case is dropped (the contact belongs to the business, ORG-037 covers a released number) |
| tests/integration/relationship/invite-supplier.test.ts | the business number is seeded as a collaborator with `isPublicContact` | the number is seeded as a verified PHONE contact of the business |

## Out of scope
- A released number going back to pending: ORG-037.
- Removing `is_public_contact`: ORG-031 and ORG-032.
