---
id: REL-024
title: Owner or manager corrects a customer's number
module: relationship
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [REL-023, ACC-002, ACC-007, REL-006, REL-007, REL-008]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/person/person.repository.ts]
design_refs: [relations-commerciales/customerrelationshipreassignment/correction-par-le-fournisseur, relations-commerciales/customerrelationshipreassignment]
constraints: [C-12, CM-24, CM-03, C-07]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# REL-024 — Owner or manager corrects a customer's number

## Story
As an owner, I want to point a customer's relationship to the right number so that the account follows the right person.

## Context
- Exists: contestation and the journal (REL-023); rule `reassign` on CustomerRelationship for MANAGER online, OWNER always (ACC-002); `findOrCreateByPhone`; `bumpScopeVersion`; `notify`.
- Adds: `POST /api/v1/organizations/{organizationId}/customers/{relationshipId}/correct-number` with `{ id, phone_number, reason?, confirm_same_customer? }`; response 200 `projectForSupplier`.
- One transaction: the target person is found or created by the number; `customer_person_id` is repointed; one journal row is added (`reassigned_by_id` = caller); the scope versions of the previous and new persons are bumped; a registered new person is notified `customer.added`.
- The target must not already have a live relationship with this supplier (409 `RELATIONSHIP_EXISTS`; the pair index would also refuse it). When the target is a person who contested this relationship, `confirm_same_customer: true` and a `reason` are required (409 `CONFIRMATION_REQUIRED` otherwise); the relationship then comes back to them and they can no longer contest it.
- A manager cannot correct a relationship where they are the customer or manage the customer organization (403 `OWN_RECORD`); counters and organization customers cannot be corrected (409 `NOT_A_PERSON_CUSTOMER`).
- `C-12`: A reassignment has previous and new person set; the new person has no relationship with the same supplier; one contestation per relationship and person; the journal is never modified.
- `CM-24`: Contestation moves the relation to a ghost person holding the number as released number; the supplier confirms 'C'est bien ce client' with a reason to bring it back to the same number, after which the customer can no longer contest; a contested invitation is deleted.
- `CM-03`: `Person.scope_version` is incremented by the server on every rights change.
- `C-07`: At most one live relationship per (supplier, customer) pair, ignoring deleted and merged rows (partial unique indexes per column combination); `supplier_organization_id` differs from `customer_organization_id`; `merged_into_id` set means the row is deleted.

## Acceptance criteria
```gherkin
Scenario: AC-1 Correct a typo
  When an OWNER posts the right number for a customer entered wrongly
  Then the relationship points to the new number's person, one journal row exists, balance and history are unchanged
  And both persons' scope_version is +1 and a registered new person is notified
Scenario: AC-2 Existing relationship
  When the new number's person already has a live relationship with this supplier
  Then the response is 409 `RELATIONSHIP_EXISTS` and nothing changes
Scenario: AC-3 Same customer after contestation
  Given the customer contested the relationship
  When the supplier posts the customer's own number without confirmation
  Then the response is 409 `CONFIRMATION_REQUIRED`
  And with confirm_same_customer true and a reason the relationship returns to that person and a second contestation is refused
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                                       | status                      |
    | a SELLER or DRIVER caller                     | 403 FORBIDDEN               |
    | a MANAGER on their own customer record        | 403 OWN_RECORD              |
    | a counter                                     | 409 NOT_A_PERSON_CUSTOMER   |
```

## Abuse cases
```gherkin
Scenario: AB-1 Moving a debt to an innocent person (tampering)
  Then the journal records who moved it, and the moved person can contest it once
```

## Implementation
- Create: `tests/integration/relationship/correct-number.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `correctCustomerNumber(actor: Actor, relationshipId: string, input: CorrectNumberInput): Promise<SupplierRelationshipView>`
- Types:
  - `CorrectNumberInput = { id: string; phone_number: string; reason?: string; confirm_same_customer?: boolean }`
- Errors: `RELATIONSHIP_EXISTS` 409, `CONFIRMATION_REQUIRED` 409, `OWN_RECORD` 403, `NOT_A_PERSON_CUSTOMER` 409, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.1: owner, or manager online.
- v5.0.0-2.3.3: repoint, journal row and scope bumps are one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| correct | integration | AC-1, C-12, CM-03 | repointed, journal, history unchanged, scope +1 each, notification |
| existing | integration | AC-2, C-07 | 409 |
| same customer | integration | AC-3, CM-24 | confirmation flow and later refusal to contest |
| refusals | integration | AC-4 | each Examples row → status |
| innocent person | security | AB-1, CWE-841 | journal row exists; contest possible once |

Command: `npx vitest run tests/integration/relationship/correct-number.test.ts`

## Out of scope
- Merging two histories: never done by the model.
