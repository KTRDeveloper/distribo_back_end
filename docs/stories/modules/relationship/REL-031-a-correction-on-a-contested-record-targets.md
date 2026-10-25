---
id: REL-031
title: A correction on a contested record targets another number and clears the mark
module: relationship
kind: change
rev: 1
amends: [REL-024]
size: S
risk: high
depends_on: [REL-028]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/relationship/relationship.schemas.ts]
design_refs: [relations-commerciales/customerrelationshipreassignment/correction-par-le-fournisseur]
constraints: [C-57, CM-24, C-12]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# REL-031 — A correction on a contested record targets another number and clears the mark

## Story
As an owner, I want to correct a contested customer's number to the right one so that the record leaves the innocent person and the mark goes away.

## Context
- Exists: `POST /api/v1/organizations/{organizationId}/customers/{relationshipId}/correct-number` with `{ id, phone_number, reason?, confirm_same_customer? }` (REL-024), including the "C'est bien ce client" flow (`confirm_same_customer`, 409 `CONFIRMATION_REQUIRED`) that brought a contested relationship back from a ghost person.
- Change: remove `confirm_same_customer` from the strict body (now an unknown key, 400) and the `CONFIRMATION_REQUIRED` error. On a contested record (`contested_at` set), a number that resolves to the current customer answers 409 `SAME_NUMBER`. A successful correction sets `contested_at` to NULL in the same transaction as the repoint and the journal entry.
- Everything else is unchanged: journal entry, scope bumps of both persons, `RELATIONSHIP_EXISTS`, `OWN_RECORD`, `NOT_A_PERSON_CUSTOMER`, roles.
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.
- `CM-24`: Contestation only sets `contested_at`, with no journal row and no change of customer; the customer then sees the record only among their hidden records, the supplier sees a contested number and is notified; only the customer clears it ('this is me'); the supplier can only correct to another number; a contested invitation is declined.
- `C-12`: A reassignment has previous and new person set; the new person has no relationship with the same supplier; the journal is never modified.
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.
- `CM-24`: Contestation only sets `contested_at`, with no journal row and no change of customer; the customer then sees the record only among their hidden records, the supplier sees a contested number and is notified; only the customer clears it ('this is me'); the supplier can only correct to another number; a contested invitation is declined.
- `C-12`: A reassignment has previous and new person set; the new person has no relationship with the same supplier; the journal is never modified.

## Acceptance criteria
```gherkin
Scenario: AC-1 Correct a contested record
  Given a relationship contested by its customer
  When an OWNER posts another number
  Then the relationship points to the new person, one journal entry exists, and `contested_at` is empty
Scenario: AC-2 Same number refused
  Given a relationship contested by its customer
  When an OWNER posts that customer's own number
  Then the response is 409 `SAME_NUMBER` and nothing changes
Scenario: AC-3 Old confirmation field
  When the body holds `confirm_same_customer`
  Then the response is 400 `VALIDATION_ERROR`
```

## Abuse cases
```gherkin
Scenario: AB-1 Pushing the debt back on the contester (tampering)
  Given a relationship contested by its customer
  When a MANAGER tries the same number with or without any extra field
  Then the answer is 409 or 400, the mark stays and the record keeps its customer
```

## Implementation
- Modify: `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`, `tests/integration/relationship/correct-number.test.ts`
- Pattern: `tests/integration/relationship/default-counter.test.ts`
- Signatures:
  - `correctCustomerNumber(actor: Actor, relationshipId: string, input: CorrectNumberInput): Promise<SupplierRelationshipView>`
- Types:
  - `CorrectNumberInput = { id: string; phone_number: string; reason?: string }`
- Dependencies: `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.1: owner, or manager online, as before.
- v5.0.0-2.3.3: repoint, journal entry, mark clear and scope bumps are one transaction.
- v5.0.0-15.3.3: the strict body no longer lists `confirm_same_customer`.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| contested correction | integration | AC-1, C-57, C-12 | another number → repointed, journal entry, mark empty |
| same number | integration | AC-2, CM-24 | own number → 409 SAME_NUMBER |
| old field | integration | AC-3 | confirm_same_customer → 400 |
| push back | security | AB-1, CWE-841 | same number → refused, mark kept |

Command: `npx vitest run tests/integration/relationship/correct-number.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/relationship/correct-number.test.ts | same customer (AC-3 of REL-024): the confirmation flow is gone | own number on a contested record → 409 SAME_NUMBER; confirm_same_customer → 400 |
| tests/integration/relationship/correct-number.test.ts | innocent person (AB-1 of REL-024): contestation no longer limited | the moved person can contest, and contest again after taking it back |

## Out of scope
- Clearing the mark without a correction: only the customer can (REL-029).
