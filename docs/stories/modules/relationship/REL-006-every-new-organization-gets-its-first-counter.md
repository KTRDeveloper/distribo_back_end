---
id: REL-006
title: Every new organization gets its first counter
module: relationship
kind: change
rev: 1
amends: [ORG-004]
size: S
risk: medium
depends_on: [REL-004, ORG-004]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/organization, relations-commerciales/customerrelationship/comptoirs]
constraints: [C-06, C-10]
asvs: [v5.0.0-2.3.3]
---

# REL-006 — Every new organization gets its first counter

## Story
Technical story: create the counter 'Client de passage' with every new organization, so that anonymous sales have a relationship to belong to.

## Context
- Exists: `createOrganization` in `organization.service.ts` (ORG-004) creating the organization and the OWNER collaboration in one transaction.
- Adds: `src/modules/relationship/relationship.repository.ts` with `createCounter(tx, { supplierOrganizationId, label, createdById })` (no customer, `credit_limit` 0, status ACTIVE).
- Changes: `createOrganization` calls it in the same transaction with label "Client de passage" and the owner as creator.
- `C-06`: A relationship has exactly one supplier (organization or person); at most one customer (person or organization), none only for a counter, and then `customer_label` is required; `customer_phone_number` is empty once `customer_person_id` is set.
- `C-10`: `credit_limit` is 0 at creation and always 0 for a counter; `credit_limit_set_by_id` and `credit_limit_set_at` are set together; every change adds one `CreditLimitChange` row in the same transaction.

## Acceptance criteria
```gherkin
Scenario: AC-1 Counter created
  When an organization is created
  Then exactly one relationship exists with no customer, customer_label "Client de passage", credit_limit 0, status ACTIVE and the owner as created_by
Scenario: AC-2 Atomic
  When the counter insert fails
  Then no organization and no collaboration exist
Scenario: AC-3 Existing behavior
  Then the response of POST /api/v1/organizations is unchanged
Scenario: AC-4 Repeat
  When the same creation body is posted twice
  Then one counter exists
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/modules/relationship/relationship.repository.ts`, `tests/integration/relationship/default-counter.test.ts`
- Modify: `src/modules/organization/organization.service.ts`
- Pattern: `src/modules/organization/organization.repository.ts`
- Signatures:
  - `createCounter(tx: Prisma.TransactionClient, input: { supplierOrganizationId: string; label: string; createdById: string }): Promise<CustomerRelationship>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: organization, owner and counter are one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| counter | integration | AC-1, C-06, C-10 | one counter with the stated values |
| atomic | integration | AC-2, CWE-362 | forced failure → nothing stored |
| unchanged response | integration | AC-3 | same body as before |
| repeat | integration | AC-4 | one counter |

Command: `npx vitest run tests/integration/relationship/default-counter.test.ts tests/integration/organization/create.test.ts`

## Out of scope
- Extra counters (REL-011).
