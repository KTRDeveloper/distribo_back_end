---
id: BIL-030
title: The owner swaps a paused product with one on sale
module: billing
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [BIL-029, BIL-020]
read_first: [src/modules/billing/swap.service.ts, src/modules/billing/billing.owner.routes.ts]
design_refs: [finances/subscription]
constraints: [C-46, C-55]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-2.3.3]
---

# BIL-030 — The owner swaps a paused product with one on sale

## Story
As an owner, I want to put a paused product back on sale by pausing another so that I sell what I need within my plan.

## Context
- Exists: `swapSeat`, `writeCurrentKeepChoice` (BIL-029), `listProductsOnSale`, `listPausedProducts`, `setProductsPaused` (CAT-020), `insertEvent`, `runInTransaction` (BIL-011), the router (BIL-018).
- `POST /api/v1/organizations/{organizationId}/billing/swap-product` on that router. Chain: sign-in, `loadActor`, `requireAbility('keep', 'Product')`, `idempotent()`. Body, strict: `id` (UUIDv7), `pause_product_id`, `resume_product_id`, two different UUIDs.
- `swapProduct(actor, input, now)` in `swap.service.ts`, one transaction under `lockSubscriptions`. An id in neither product list is 404 `NOT_FOUND`; the one to pause must be on sale and the one to resume paused (else 409 `PRODUCT_STATE`).
- It calls `setProductsPaused` for each, writes a PAUSED and a RESUMED event (actor OWNER, details: target PRODUCTS and the product id) and `writeCurrentKeepChoice`. Answer 201 `{ paused_product_id, resumed_product_id }`.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.
- `C-55`: `SubscriptionEvent`: `person_id` is set exactly when `actor = OWNER`; `administrator_id` and `admin_action_id` are set exactly when `actor = ADMINISTRATOR`; `payment_id` is set when `actor = PAYER`; no update, no delete.

## Acceptance criteria
```gherkin
Scenario: AC-1 A swap
  Given limit 30, 30 products on sale and product P paused
  When the owner pauses product Q and resumes P
  Then the answer is 201, Q is paused, P is on sale, and one PAUSED, one RESUMED and one KEEP_CHOICE event name the owner
Scenario: AC-2 The swap sticks
  When `enforceLimits` runs with limit 30 after AC-1
  Then Q stays paused and P stays on sale
Scenario Outline: AC-3 A state that refuses
  When <case>
  Then the answer is <answer> and nothing changes
  Examples:
    | case                                  | answer                        |
    | the product to pause is already paused | 409 `PRODUCT_STATE`           |
    | the product to resume is on sale      | 409 `PRODUCT_STATE`           |
    | an id is unknown or deleted           | 404 `NOT_FOUND`, same message |
Scenario: AC-4 Who may
  When a manager, a seller, a driver or a person not signed in sends a valid swap
  Then the answers are 403 `FORBIDDEN` for the first three and 401 `UNAUTHORIZED` for the last
Scenario: AC-5 Body and repeat
  When the body has an extra field, a bad UUID or the same id twice, then a valid swap is sent twice with one `id`
  Then the first three give 400 `VALIDATION_ERROR` and the repeat gives equal answers with one set of events
```

## Abuse cases
```gherkin
Scenario: AB-1 A product of another business is paused (broken access control)
  When an owner of A sends a product id of business B
  Then the answer is 404, equal to an unknown id's, and B's product is unchanged
```

## Implementation
- Create: `tests/integration/billing/swap-product.test.ts`
- Modify: `src/modules/billing/swap.service.ts`, `src/modules/billing/billing.owner.routes.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `swapProduct(actor: OrganizationActor, input: SwapProductInput, now: Date): Promise<SwapProductView>`
- Types:
  - `SwapProductInput = { id: string; pauseProductId: string; resumeProductId: string }`
  - `SwapProductView = { paused_product_id: string; resumed_product_id: string }`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `PRODUCT_STATE` 409
- Dependencies: `zod`, `express`

## Security
- v5.0.0-8.2.1: only an owner passes `keep`, and the business comes from the session actor.
- v5.0.0-15.3.3: the body lists its writable fields and refuses any other.
- v5.0.0-2.3.3: products, events and the choice are written in one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| swap | integration | AC-1, C-55 | 201, products, events |
| sticks | integration | AC-2, C-46 | enforcement keeps the swap |
| refused | integration | AC-3 | each Examples row → answer, no change |
| who may | integration | AC-4 | 403 and 401 |
| body and repeat | integration | AC-5 | 400s, equal answers, one set of events |
| other business | security | AB-1, CWE-639 | 404 equal to unknown, B unchanged |

Command: `npx vitest run tests/integration/billing/swap-product.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | route list | add POST /api/v1/organizations/{organizationId}/billing/swap-product |
| tests/integration/per-001.test.ts | route list | add POST /api/v1/organizations/{organizationId}/billing/swap-product |

## Out of scope
- Swapping a collaborator: BIL-029.
