---
id: REL-028
title: Contesting marks the record instead of moving it to a ghost person
module: relationship
kind: change
rev: 1
amends: [REL-023]
size: M
risk: high
depends_on: [REL-027]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/relationship/relationship.repository.ts]
design_refs: [relations-commerciales/customerrelationshipreassignment/ce-n-est-pas-moi-erreurs-de-saisie-et]
constraints: [CM-24]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# REL-028 — Contesting marks the record instead of moving it to a ghost person

## Story
As a customer, I want "this is not me" to hide the record from me without moving it so that the supplier keeps the debt and I can take the contestation back.

## Context
- Exists: `POST /api/v1/suppliers/{relationshipId}/contest` `{ id, reason? }`, 204 (REL-023), which moves the record to a ghost person with a journal entry and a scope bump.
- Change: same route, body and answer. In one transaction under the row lock: when `contested_at` is already set, 409 `ALREADY_CONTESTED`; otherwise set `contested_at` to the server time and notify the supplier's OWNER and MANAGERs `relationship.contested` as today. `customer_person_id`, balance and history do not change. No ghost person, no journal entry, no `scope_version` bump (the relationship stays in the caller's scope).
- The "one contestation per relationship and person" rule is gone: after "this is me" (REL-029), the customer may contest again.
- `reason` is still validated but no longer stored, and never logged.
- Remove `insertGhostPerson` and `hasContested` from `relationship.repository.ts` and their imports; keep `findCustomerRelationshipLocked`.
- `CM-24`: Contestation only sets `contested_at`, with no journal row and no change of customer; the customer then sees the record only among their hidden records, the supplier sees a contested number and is notified; only the customer clears it ('this is me'); the supplier can only correct to another number; a contested invitation is declined.
- `CM-24`: Contestation only sets `contested_at`, with no journal row and no change of customer; the customer then sees the record only among their hidden records, the supplier sees a contested number and is notified; only the customer clears it ('this is me'); the supplier can only correct to another number; a contested invitation is declined.

## Acceptance criteria
```gherkin
Scenario: AC-1 Contest marks the record
  When a customer contests an ACTIVE relationship
  Then the response is 204, `contested_at` is set, `customer_person_id` is still the caller, and no person and no journal entry were created
Scenario: AC-2 Notices
  Then the supplier's owner and managers have one notification `relationship.contested` and the caller's scope_version is unchanged
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                   | status                |
    | a relationship already contested          | 409 ALREADY_CONTESTED |
    | a relationship of another person          | 404 NOT_FOUND         |
    | a PENDING invitation (decline it instead) | 404 NOT_FOUND         |
Scenario: AC-4 Contest again after taking it back
  Given the customer contested, then said "this is me"
  When they contest again with a new gesture id
  Then the response is 204 and `contested_at` is set
```

## Abuse cases
```gherkin
Scenario: AB-1 Making a debt disappear (tampering)
  When an indebted customer contests
  Then the balance stays on the same relationship, the supplier still sees it, and only the customer's view hides it
Scenario: AB-2 Contesting someone else's relationship (horizontal)
  When person A contests a relationship of person B
  Then the response is 404 and `contested_at` stays empty
```

## Implementation
- Modify: `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.schemas.ts`, `tests/integration/relationship/contest.test.ts`
- Pattern: `tests/integration/relationship/default-counter.test.ts`
- Signatures:
  - `contestRelationship(personId: string, relationshipId: string, input: { id: string; reason?: string }): Promise<void>`
- Dependencies: `@prisma/client`, `zod`

## Security
- v5.0.0-8.2.2: the relationship is selected with the caller as `customer_person_id`.
- v5.0.0-2.3.3: the check and the mark are one transaction under the row lock, so two concurrent contests give one 204 and one 409.
- v5.0.0-16.3.1: log `warn` event `relationship_contested` with relationship and person ids, never the reason.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| contest | integration | AC-1, CM-24 | contest → mark set, same customer, no ghost, no journal entry |
| notices | integration | AC-2 | one notification, scope unchanged |
| refusals | integration | AC-3 | each Examples row → status |
| again | integration | AC-4 | contest, this is me, contest → 204 |
| debt kept | security | AB-1, CWE-841 | supplier view still shows the balance |
| other person | security | AB-2, WSTG-ATHZ-04 | 404, mark empty |

Command: `npx vitest run tests/integration/relationship/contest.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/relationship/contest.test.ts | contest, notices, atomic: no ghost person, no journal entry, no scope bump | same customer, `contested_at` set, scope unchanged; the atomic case is removed |
| tests/integration/relationship/contest.test.ts | refusals, loop: the one-contestation rule is gone | 409 only while `contested_at` is set; loop becomes AB-1 debt kept |

## Out of scope
- The hidden list and the views that show the mark: REL-030. Taking the contestation back: REL-029.
