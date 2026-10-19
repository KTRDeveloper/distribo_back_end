---
id: BIL-020
title: Products beyond the plan are paused and come back when it allows
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-019, BIL-013, CAT-020, ORD-029, ORG-044]
read_first: [src/modules/billing/seat-limit.service.ts, src/modules/billing/notices.ts]
design_refs: [finances/subscription, catalogue/product]
constraints: [C-46]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# BIL-020 — Products beyond the plan are paused and come back when it allows

## Story
Technical story: give billing the one function that applies the limits of a plan to a business, pausing the products and the collaborators beyond them and bringing back what fits, so that a plan change never deletes anything.

## Context
- Exists: `listProductsOnSale`, `listPausedProducts`, `setProductsPaused` (CAT-020), `countOrderedLinesByVariant` (ORD-029), `findLatestKeepChoice` and `enforceSeatLimit` (BIL-019), `findActiveOwnerId` (ORG-044), `OrganizationRights` (BIL-013).
- New `limits.service.ts`: `enforceLimits(tx, organizationId, rights, now)` first calls `enforceSeatLimit` with `rights.maxCollaborators`, then handles products with `rights.maxProducts` (`null` means no limit).
- Products: the on-sale and the paused lists are ranked together: first the product ids of the latest choice, in the order given; then by demand, the sum of `countOrderedLinesByVariant(…, now − 90 days)` over the product's variant ids, highest first; ties newest first, then by id. The first `maxProducts` are on sale: the paused ones among them are resumed, the on-sale ones outside are paused, with `setProductsPaused`.
- Each non-empty change writes one PAUSED or RESUMED event (actor SYSTEM, details: target PRODUCTS and the count) and notifies the owner once: `subscription.products_paused` or `subscription.products_resumed`, in their language (texts added to `notices.ts`, with the count only).
- Returns `{ seats, productsPaused, productsResumed }`.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.

## Acceptance criteria
```gherkin
Scenario: AC-1 The most ordered stay
  Given a limit of 3 and 5 products on sale, ordered 9, 7, 5, 2 and 0 times in the last 90 days
  When the limits are enforced
  Then the first three stay and the other two are paused
Scenario: AC-2 Ties and old orders
  Given two products with the same demand, one newer, and a third whose orders are 91 days old
  When the limits are enforced with room for one
  Then the newer of the two stays and the third has no demand
Scenario: AC-3 The owner's choice
  Given a limit of 2 and a choice naming the least ordered product
  When the limits are enforced
  Then that product stays with the most ordered one
Scenario Outline: AC-4 They come back
  Given 4 products, 2 of them paused
  When the limit becomes <limit>
  Then <result>
  Examples:
    | limit     | result                              |
    | 3         | one paused product returns, by rank |
    | no limit  | both return                         |
Scenario: AC-5 Seats too
  When the limits are enforced for a business over its collaborator limit
  Then its seats are paused as in BIL-019 and the answer carries that result
Scenario: AC-6 Journal and notice
  When products are paused
  Then one PAUSED event with the count exists and the owner has one notice with the count, and a second run changes and writes nothing
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's products or orders count or change (broken access control)
  Given business B has products and orders
  When the limits are enforced for business A
  Then no product of B changes and B's orders add nothing to A's demand
```

## Implementation
- Create: `src/modules/billing/limits.service.ts`, `tests/integration/billing/limits.test.ts`
- Modify: `src/modules/billing/notices.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `enforceLimits(tx: Prisma.TransactionClient, organizationId: string, rights: OrganizationRights, now: Date): Promise<LimitsEnforcement>`
  - `productsNotice(kind: 'PAUSED' | 'RESUMED', language: 'FR' | 'EN', count: number): string`
- Types:
  - `LimitsEnforcement = { seats: SeatEnforcement; productsPaused: number; productsResumed: number }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: every call is bound to the organization id given by server code.
- v5.0.0-2.3.3: pauses, events and notices belong to the caller's transaction.
- v5.0.0-16.3.1: the event and the notice carry a count, never product names or ids.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| most ordered | integration | AC-1, C-46 | five products → three on sale |
| ties | integration | AC-2 | newer first, old orders ignored |
| choice | integration | AC-3 | chosen product stays |
| return | integration | AC-4 | each Examples row → result |
| seats | integration | AC-5 | result carries the seat outcome |
| journal | integration | AC-6 | event, notice, repeat changes nothing |
| other business | security | AB-1, CWE-639 | B unchanged, no demand from B |

Command: `npx vitest run tests/integration/billing/limits.test.ts tests/integration/billing/seat-limit.test.ts`

## Out of scope
- Computing the rights and the callers: BIL-014 and BIL-028.
- Pausing the excess products that arrive by synchronization: the synchronization stories.
