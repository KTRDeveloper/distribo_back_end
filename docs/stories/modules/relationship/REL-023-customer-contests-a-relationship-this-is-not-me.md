---
id: REL-023
title: Customer contests a relationship ("this is not me")
module: relationship
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [REL-014, REL-016, ACC-007, NTF-002, REL-006, REL-007, REL-008]
read_first: [src/modules/relationship/relationship.repository.ts, src/modules/person/person.repository.ts]
design_refs: [relations-commerciales/customerrelationshipreassignment/ce-n-est-pas-moi-erreurs-de-saisie-et]
constraints: [C-12, CM-24, CM-03, C-02]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# REL-023 — Customer contests a relationship ("this is not me")

## Story
As a customer, I want to say "this is not me" about a relationship so that a debt entered on my number by mistake or by the previous holder leaves my account.

## Context
- Exists: the reassignment journal (REL-014); `bumpScopeVersion`; `notify`; `idempotent()`.
- Adds: `POST /api/v1/suppliers/{relationshipId}/contest` with `{ id, reason? }`; response 204. The caller must be `customer_person_id` of an ACTIVE or ENDED relationship.
- One transaction: a ghost person is created (no name, no active number, `released_phone_number` = the caller's active number, not registered); the relationship's `customer_person_id` becomes the ghost; one journal row is added (`previous_person_id` = caller, `new_person_id` = ghost, `reassigned_by_id` = caller, `reason`); the caller's `scope_version` is bumped; the supplier's OWNER and MANAGERs are notified `relationship.contested` ("un numéro est à corriger"). The relationship disappears from the caller's lists.
- A second contestation of the same relationship by the same person answers 409 `ALREADY_CONTESTED`. Balance and history are untouched.
- `C-12`: A reassignment has previous and new person set; the new person has no relationship with the same supplier; one contestation per relationship and person; the journal is never modified.
- `CM-24`: Contestation moves the relation to a ghost person holding the number as released number; the supplier confirms 'C'est bien ce client' with a reason to bring it back to the same number, after which the customer can no longer contest; a contested invitation is deleted.
- `CM-03`: `Person.scope_version` is incremented by the server on every rights change.
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` is empty.

## Acceptance criteria
```gherkin
Scenario: AC-1 Contest
  When a customer contests a relationship
  Then the relationship points to a ghost person holding the number as released number, one journal row exists, and the caller no longer sees it
Scenario: AC-2 Notices and counters
  Then the caller's scope_version is +1 and the supplier's owner and managers have one notification `relationship.contested`
Scenario: AC-3 History kept
  Then balance, orders and ledger entries still point to the same relationship
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                         | status                |
    | a second contestation by the same person        | 409 ALREADY_CONTESTED |
    | a relationship of another person                | 404 NOT_FOUND         |
    | a PENDING invitation (decline it instead)       | 404 NOT_FOUND         |
Scenario: AC-5 Atomic
  When the journal insert fails
  Then no ghost person exists and the relationship is unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 Making a debt disappear in a loop (tampering)
  When the customer contests, the supplier restores the same number, and the customer contests again
  Then the second contestation answers 409 and the debt stays on the customer's account
Scenario: AB-2 Contesting someone else's relationship (horizontal)
  When person A contests a relationship of person B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/relationship/contest.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `contestRelationship(personId: string, relationshipId: string, input: { id: string; reason?: string }): Promise<void>`
- Errors: `ALREADY_CONTESTED` 409, `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.2: the relationship is selected with the caller as `customer_person_id`.
- v5.0.0-2.3.3: ghost person, reassignment, journal and scope bump are one transaction.
- v5.0.0-16.3.1: log `warn` event `relationship_contested` with relationship and person ids.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| contest | integration | AC-1, C-12, C-02 | ghost, journal row, hidden from caller |
| notices | integration | AC-2, CM-03 | scope +1, notifications |
| history kept | integration | AC-3 | ids unchanged |
| refusals | integration | AC-4, CM-24 | each Examples row → status |
| atomic | integration | AC-5, CWE-362 | forced failure → unchanged |
| loop | security | AB-1, CWE-841 | second contest → 409 |
| other person | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/relationship/contest.test.ts`

## Out of scope
- Contesting a team invitation (ORG-008 decline) or a supplier invitation (REL-021 decline).
