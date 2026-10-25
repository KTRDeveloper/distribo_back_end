---
id: REL-030
title: Both parties see the contested mark and the customer's hidden list
module: relationship
kind: change
rev: 1
amends: [REL-005, REL-008, REL-009, REL-016]
size: M
risk: medium
depends_on: [REL-027]
read_first: [src/modules/relationship/relationship.visibility.ts, src/modules/relationship/relationship.repository.ts]
design_refs: [relations-commerciales/customerrelationship, relations-commerciales/customerrelationshipreassignment/ce-n-est-pas-moi-erreurs-de-saisie-et]
constraints: [CM-24, C-57]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# REL-030 — Both parties see the contested mark and the customer's hidden list

## Story
As a supplier, I want to see that a customer's number is contested, and as a customer, I want contested records out of my list but still reachable, so that each side knows where the record stands.

## Context
- Exists: `projectForSupplier` and `projectForCustomer` (REL-005); `GET /api/v1/organizations/{organizationId}/customers` (REL-008) and its single read (REL-009); `GET /api/v1/suppliers?limit&cursor&status` (REL-016).
- Change: both projections add `contested_at` (ISO timestamp or null); the driver projection does not. Document it in the two view schemas of `relationship.openapi.ts`.
- `GET /api/v1/suppliers` excludes contested records by default and takes a new query `contested` (`true` | `false`, default `false`): `contested=true` lists only the caller's contested records (the hidden records), newest first, same paging. `status` still combines with it.
- The supplier's list and single read are unchanged apart from the field: the record stays visible with its balance.
- `CM-24`: Contestation only sets `contested_at`, with no journal row and no change of customer; the customer then sees the record only among their hidden records, the supplier sees a contested number and is notified; only the customer clears it ('this is me'); the supplier can only correct to another number; a contested invitation is declined.
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.
- `CM-24`: Contestation only sets `contested_at`, with no journal row and no change of customer; the customer then sees the record only among their hidden records, the supplier sees a contested number and is notified; only the customer clears it ('this is me'); the supplier can only correct to another number; a contested invitation is declined.
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.

## Acceptance criteria
```gherkin
Scenario: AC-1 Supplier sees the mark
  Given a relationship contested by its customer
  When a seller lists the customers or opens that customer
  Then the item is present with its balance and `contested_at` set
Scenario: AC-2 Customer list hides it
  When the customer lists their suppliers without `contested`
  Then the contested record is absent and the others are present with `contested_at` null
Scenario: AC-3 Hidden records
  When the customer lists with `contested=true`
  Then only the contested records are returned, with `contested_at` set
Scenario: AC-4 Driver
  Then the driver projection has no `contested_at`
Scenario: AC-5 Query validation
  When `contested` is any other value
  Then the response is 400 `VALIDATION_ERROR`
```

## Abuse cases
```gherkin
Scenario: AB-1 Another person's hidden records (horizontal)
  When person A lists with `contested=true`
  Then no record of person B appears
```

## Implementation
- Create: `tests/integration/relationship/contested-views.test.ts`
- Modify: `src/modules/relationship/relationship.visibility.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.openapi.ts`, `tests/integration/relationship/visibility.test.ts`
- Pattern: `tests/integration/relationship/default-counter.test.ts`
- Signatures:
  - `listSuppliersOfPerson(personId: string, query: ListSuppliersQuery): Promise<{ items: CustomerRelationshipView[]; next_cursor: string | null }>`
- Types:
  - `ListSuppliersQuery = { limit: number; cursor?: string; status?: 'PENDING' | 'ACTIVE' | 'ENDED'; contested: boolean }`
- Dependencies: `zod`, `@prisma/client`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.2: the hidden list starts from `customer_person_id` = caller, like the main list.
- v5.0.0-15.3.1: the field is added to the explicit projection lists, never by spreading the row.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| supplier mark | integration | AC-1, CM-24 | list and single read → present, balance, contested_at set |
| customer list | integration | AC-2 | default → contested record absent |
| hidden list | integration | AC-3, C-57 | contested=true → only contested records |
| driver | integration | AC-4 | driver view keys unchanged |
| query | integration | AC-5 | contested=maybe → 400 |
| other person | security | AB-1, WSTG-ATHZ-04 | contested=true → none of B's records |

Command: `npx vitest run tests/integration/relationship/contested-views.test.ts tests/integration/relationship/visibility.test.ts tests/integration/relationship/list-suppliers.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/relationship/visibility.test.ts | the supplier and customer view key lists | each lists `contested_at`; the driver list is unchanged |

## Out of scope
- Sending the field to phones by synchronization: SYNC-044.
