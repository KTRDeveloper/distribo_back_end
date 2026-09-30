---
id: PER-006
title: Look up a person by phone number
module: person
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [PER-005, FND-006]
read_first: [docs/stories/modules/person/contracts.md, src/modules/tasks/tasks.routes.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-20]
asvs: [v5.0.0-2.4.1, v5.0.0-8.2.1, v5.0.0-15.3.1]
---

# PER-006 — Look up a person by phone number

## Story
As a seller, I want to see who a phone number belongs to before I add it as a customer so that I catch typing mistakes.

## Context
- Exists: `findByActivePhone`, `toPublicPerson` (PER-005); `authMiddleware`; `checkAndConsume` in `src/lib/rate-limit.ts`; `normalizeE164`.
- Adds: `GET /api/v1/people/lookup?phone=<number>` for any signed-in person. Response 200 `{ phone_number, registered, public_name }`; an unknown number, a guest or a released number all answer `{ phone_number, registered: false, public_name: null }`.
- Limit: 60 lookups per hour per person (Q-006), answered 429 `RATE_LIMITED`.
- `CM-20`: An organization receives from a person only the public name, the number and whether they are registered.

## Acceptance criteria
```gherkin
Scenario: AC-1 Registered person
  Given a registered person named "Béatrice Ngono" with number +237677123456
  When a signed-in person looks up "6 77 12 34 56"
  Then the response is 200 with phone_number +237677123456, registered true, public_name "Béatrice Ngono"
Scenario: AC-2 Unknown, guest and released numbers look the same
  When a signed-in person looks up an unknown number, a guest's number and a released number
  Then each response is 200 with registered false and public_name null
Scenario: AC-3 Invalid number
  When the query is missing or not a mobile number
  Then the response is 400 `VALIDATION_ERROR`
Scenario Outline: AC-4 Hourly limit
  When a person makes <count> lookups within one hour
  Then the last one answers <status>
  Examples:
    | count | status |
    | 60    | 200    |
    | 61    | 429    |
```

## Abuse cases
```gherkin
Scenario: AB-1 Private fields (information disclosure)
  When a lookup hits a registered person with an email
  Then the body has only phone_number, registered and public_name
Scenario: AB-2 Enumeration by guessing numbers (anti-automation)
  When one person looks up 61 different numbers in an hour
  Then the 61st is refused with 429 and a `warn` log event `lookup_rate_limited` with the person id
Scenario: AB-3 No token (unauthenticated)
  When the request has no valid access token
  Then the response is 401
```

## Implementation
- Create: `src/modules/person/person.routes.ts`, `src/modules/person/person.schemas.ts`, `src/modules/person/person.openapi.ts`, `tests/integration/person/person-lookup.test.ts`
- Modify: `src/app.ts`
- Pattern: `src/modules/tasks/tasks.routes.ts`
- Signatures:
  - `lookupPerson(callerId: string, phone: string): Promise<PublicPerson>`
- Types:
  - `LookupQuery = { phone: string }`
- Errors: `VALIDATION_ERROR` 400, `RATE_LIMITED` 429, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`, `ioredis`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-2.4.1: key `lookup:<personId>`, limit 60, window 3600 seconds.
- v5.0.0-15.3.1: response built by `toPublicPerson` only.
- v5.0.0-8.2.1: route behind `authMiddleware`.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| registered | integration | AC-1 | seeded person, spaced number → 200 with name |
| indistinguishable | integration | AC-2, CM-20 | unknown, guest, released → same shape and values |
| invalid | integration | AC-3 | no query, landline → 400 |
| limit | integration | AC-4 | 60 calls → 200, 61st → 429 (rate-limit function mocked with a counter) |
| no private fields | security | AB-1, WSTG-ATHZ-02 | keys are exactly three |
| enumeration | security | AB-2, WSTG-BUSL-07 | 61 numbers → 429 and log event |
| no token | security | AB-3, WSTG-ATHN-04 | no header → 401 |

Command: `npx vitest run tests/integration/person/person-lookup.test.ts`

## Out of scope
- Looking up an organization by number (ORG module).
- Adding the customer (REL module).
