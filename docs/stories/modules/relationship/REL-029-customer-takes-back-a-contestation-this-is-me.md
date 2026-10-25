---
id: REL-029
title: Customer takes back a contestation ("this is me")
module: relationship
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [REL-028]
read_first: [src/modules/relationship/relationship.routes.ts, src/modules/relationship/relationship.service.ts]
design_refs: [relations-commerciales/customerrelationshipreassignment/ce-n-est-pas-moi-erreurs-de-saisie-et]
constraints: [C-57, CM-24]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.3, v5.0.0-2.3.3]
---

# REL-029 — Customer takes back a contestation ("this is me")

## Story
As a customer, I want to say "this is me" about a record I contested by mistake so that the record comes back to my list without asking anyone.

## Context
- Exists: the contest route and `contested_at` (REL-028); `idempotent()`; `findCustomerRelationshipLocked`.
- Adds: `POST /api/v1/suppliers/{relationshipId}/uncontest` with a strict body `{ id }` (UUIDv7 gesture id), response 204. Online only, for the person who is `customer_person_id`.
- One transaction under the row lock: when `contested_at` is empty, 409 `NOT_CONTESTED`; otherwise set it to NULL. No notification (the design names none), no journal entry, no `scope_version` bump.
- The supplier has no route to clear the mark; their only way is a correction to another number (REL-031).
- Register the path in `relationship.openapi.ts`, and add it to the route lists of `tests/integration/api-docs/catalog.test.ts` and `tests/integration/per-001.test.ts`.
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.
- `CM-24`: Contestation only sets `contested_at`, with no journal row and no change of customer; the customer then sees the record only among their hidden records, the supplier sees a contested number and is notified; only the customer clears it ('this is me'); the supplier can only correct to another number; a contested invitation is declined.
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.
- `CM-24`: Contestation only sets `contested_at`, with no journal row and no change of customer; the customer then sees the record only among their hidden records, the supplier sees a contested number and is notified; only the customer clears it ('this is me'); the supplier can only correct to another number; a contested invitation is declined.

## Acceptance criteria
```gherkin
Scenario: AC-1 Take it back
  Given the customer contested a relationship
  When they post "this is me"
  Then the response is 204 and `contested_at` is empty
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                   | status            |
    | a relationship that is not contested      | 409 NOT_CONTESTED |
    | a relationship of another person          | 404 NOT_FOUND     |
    | an unknown body field                     | 400 VALIDATION_ERROR |
Scenario: AC-3 Repeat of the same gesture
  When the same gesture id is sent twice
  Then the second answer is 204 too and nothing else changes
```

## Abuse cases
```gherkin
Scenario: AB-1 The supplier clears the mark (elevation)
  Given a relationship contested by its customer
  When the supplier's owner calls the route
  Then the response is 404 and `contested_at` stays set
```

## Implementation
- Create: `tests/integration/relationship/uncontest.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.openapi.ts`, `tests/integration/api-docs/catalog.test.ts`, `tests/integration/per-001.test.ts`
- Pattern: `tests/integration/relationship/default-counter.test.ts`
- Signatures:
  - `uncontestRelationship(personId: string, relationshipId: string, input: { id: string }): Promise<void>`
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.2: the relationship is selected with the caller as `customer_person_id`; anyone else gets 404.
- v5.0.0-15.3.3: the body holds only `id`; `contested_at` is written by the server.
- v5.0.0-2.3.3: the check and the clear are one transaction under the row lock.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| take back | integration | AC-1, C-57, CM-24 | contested → 204, mark empty |
| refusals | integration | AC-2 | each Examples row → status |
| repeat | integration | AC-3 | same id twice → 204, one change |
| supplier | security | AB-1, WSTG-ATHZ-02 | owner calls → 404, mark kept |

Command: `npx vitest run tests/integration/relationship/uncontest.test.ts`

## Out of scope
- Showing the hidden records: REL-030.
