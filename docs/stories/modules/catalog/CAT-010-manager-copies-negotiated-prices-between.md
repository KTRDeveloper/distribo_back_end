---
id: CAT-010
title: Manager copies negotiated prices between customers
module: catalog
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [CAT-009, ACC-007, CAT-003]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [relations-commerciales/customerprice]
constraints: [C-11, C-04]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# CAT-010 — Manager copies negotiated prices between customers

## Story
As a manager, I want to copy one customer's negotiated prices to another so that similar customers get the same deals.

## Context
- Exists: prices (CAT-008, CAT-009); `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/customers/{relationshipId}/prices/copy` with `{ id, from_relationship_id }` (MANAGER online or OWNER); response 200 `{ copied: number }`.
- Both relationships must be the organization's own customers (ACTIVE or ENDED, not PENDING); the same own-record rule applies to the target. One transaction upserts each live source price onto the target (an existing target price is replaced) with the caller as author. The source is unchanged.
- `C-11`: `CustomerPrice` is unique per (relationship, product) among rows not deleted; the product belongs to the supplier of the relationship.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.

## Acceptance criteria
```gherkin
Scenario: AC-1 Copy
  Given a source with 3 negotiated prices and a target with 1 of them at another price
  When a MANAGER copies
  Then the response is `{ copied: 3 }` and the target has those 3 live prices, the source unchanged
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                       | status         |
    | the same relationship as source and target    | 400            |
    | a source of another business                  | 404            |
    | a SELLER caller                               | 403            |
    | the target is the manager's own record        | 403 OWN_RECORD |
Scenario: AC-3 Atomic and repeatable
  When one row fails, or the same id is sent twice
  Then nothing is copied, or the second answer equals the first
```

## Abuse cases
```gherkin
Scenario: AB-1 Copying from another business (horizontal)
  When the source belongs to business B
  Then the response is 404 and no price is copied
```

## Implementation
- Create: `tests/integration/catalog/copy-prices.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/catalog/catalog.routes.ts`
- Signatures:
  - `copyCustomerPrices(actor: Actor, targetRelationshipId: string, input: { id: string; from_relationship_id: string }): Promise<{ copied: number }>`
- Errors: `OWN_RECORD` 403, `NOT_FOUND` 404, `FORBIDDEN` 403, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: both relationships are selected through the actor's organization.
- v5.0.0-2.3.3: all upserts are one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| copy | integration | AC-1, C-11, C-04 | 3 copied, source unchanged |
| refusals | integration | AC-2 | each Examples row → status |
| atomic and repeat | integration | AC-3, CWE-362 | rollback; equal answers |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/catalog/copy-prices.test.ts`

## Out of scope
- Copying a whole catalog.
