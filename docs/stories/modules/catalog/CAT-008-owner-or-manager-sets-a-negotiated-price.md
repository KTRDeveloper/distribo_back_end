---
id: CAT-008
title: Owner or manager sets a negotiated price
module: catalog
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [CAT-002, CAT-006, REL-009, ACC-002, ACC-007, NTF-002, CAT-003]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/relationship/relationship.service.ts]
design_refs: [relations-commerciales/customerprice]
constraints: [C-11, C-04]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# CAT-008 — Owner or manager sets a negotiated price

## Story
As a manager, I want to set a customer's own price for an article so that a negotiation is kept.

## Context
- Exists: `customer_prices` (CAT-002); `requireAbility('create', 'CustomerPrice')` (MANAGER online, OWNER always); `getActiveProduct`; `notify`; `idempotent()`.
- Adds: `PUT /api/v1/organizations/{organizationId}/customers/{relationshipId}/prices/{productId}` with `{ id, price }` (integer of at least 1); response 200 `{ product_id, price, set_by_id, set_at }`.
- The relationship must be visible to the organization as supplier and not a PENDING invitation; the product must belong to the organization (any status). A live price for the pair is replaced (the last writer wins); otherwise one is created. `set_by_id` is the caller; `set_at` is server time.
- The caller may not be the customer person or manage the customer organization (403 `OWN_RECORD`). A registered customer gets a notification `price.negotiated_changed` naming the article.
- `C-11`: `CustomerPrice` is unique per (relationship, product) among rows not deleted; the product belongs to the supplier of the relationship.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.

## Acceptance criteria
```gherkin
Scenario: AC-1 Create
  When a MANAGER sets 2800 for an article priced 3000
  Then the response is 200 and one live price exists with the caller as author
Scenario: AC-2 Replace
  When another price 3200 is set for the same pair
  Then one live price exists with 3200 and set_at later
Scenario: AC-3 Higher than the product price
  When a negotiated price above the product price is set
  Then it is stored
Scenario: AC-4 Customer notified
  Then a registered customer has one unread notification `price.negotiated_changed`
Scenario Outline: AC-5 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                                        | status                |
    | price 0 or 1.5                                 | 400 VALIDATION_ERROR  |
    | a product of another business                  | 404 NOT_FOUND         |
    | a SELLER or DRIVER caller                      | 403 FORBIDDEN         |
    | a manager on their own customer record         | 403 OWN_RECORD        |
    | a PENDING relationship                         | 409 RELATIONSHIP_NOT_ACTIVE |
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller sets prices (vertical)
  When a SELLER or DRIVER puts a price
  Then the response is 403 and nothing is stored
Scenario: AB-2 Self-discount (elevation)
  When a MANAGER who is the customer sets their own price
  Then the response is 403 `OWN_RECORD`
Scenario: AB-3 Foreign product or relationship (horizontal)
  When the product or the relationship belongs to another business
  Then the response is 404 and nothing is stored
```

## Implementation
- Create: `tests/integration/catalog/set-customer-price.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/catalog/catalog.routes.ts`
- Signatures:
  - `setCustomerPrice(actor: Actor, relationshipId: string, productId: string, input: { id: string; price: number }): Promise<CustomerPriceView>`
- Errors: `OWN_RECORD` 403, `RELATIONSHIP_NOT_ACTIVE` 409, `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner.
- v5.0.0-8.2.2: relationship and product are both selected through the actor's organization.
- v5.0.0-15.3.3: strict schema with two fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| create | integration | AC-1, C-11, C-04 | one live price, author |
| replace | integration | AC-2 | one row, 3200 |
| higher price | integration | AC-3 | stored |
| customer notified | integration | AC-4 | notification |
| refusals | integration | AC-5 | each Examples row → status |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |
| self discount | security | AB-2, CWE-639 | OWN_RECORD |
| foreign ids | security | AB-3, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/catalog/set-customer-price.test.ts`

## Out of scope
- Removing a price (CAT-009). Suggesting to keep a price at sale time (DLV module screens).
