---
id: BIL-018
title: The owner chooses who and what to keep when a plan ends
module: billing
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [BIL-006, BIL-007, BIL-011, ORG-035, CAT-020]
read_first: [src/modules/billing/subscription.repository.ts, src/app.ts]
design_refs: [finances/subscription]
constraints: [C-55]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-2.2.1]
---

# BIL-018 — The owner chooses who and what to keep when a plan ends

## Story
As an owner, I want to choose which collaborators and products stay when my plan ends so that the ones I need are not paused.

## Context
- Exists: the rows `keep` for the OWNER on Collaboration and Product (BIL-006); `insertEvent` (BIL-011); `listTeamSeats` (ORG-035); `listProductsOnSale` and `listPausedProducts` (CAT-020); `loadActor`, `requireAbility`, `idempotent`.
- `POST /api/v1/organizations/{organizationId}/billing/keep-choice`, on a new `billing.owner.routes.ts` (router with `mergeParams`) mounted in `src/app.ts` at `/organizations/:organizationId/billing`. Chain: sign-in, `loadActor`, `requireAbility('keep', 'Collaboration')`, `requireAbility('keep', 'Product')`, `idempotent()`.
- Body, strict: `id` (UUIDv7), `collaboration_ids` and `product_ids`, each a list of at most 100 distinct UUIDs, possibly empty.
- Each collaboration id must be a seat of `listTeamSeats` and each product id a product of the two product lists; otherwise 404 `NOT_FOUND`, one message, nothing stored.
- It inserts one KEEP_CHOICE event (actor OWNER, the actor's person id, details: both lists) and answers 201 `{ collaboration_ids, product_ids }`. The choice is applied by BIL-019 and BIL-020; the last one stored wins.
- `C-55`: `SubscriptionEvent`: `person_id` is set exactly when `actor = OWNER`; `administrator_id` and `admin_action_id` are set exactly when `actor = ADMINISTRATOR`; `payment_id` is set when `actor = PAYER`; no update, no delete.

## Acceptance criteria
```gherkin
Scenario: AC-1 A choice is stored
  When the owner sends two seats and three products of the business
  Then the answer is 201 with those lists and one KEEP_CHOICE event exists, actor OWNER, with the owner's person id and both lists
Scenario: AC-2 A later choice
  When the owner sends a second choice
  Then two events exist and the first is unchanged
Scenario Outline: AC-3 Ids that are not the business's
  When a list holds <id>
  Then the answer is 404 `NOT_FOUND` with the same message and no event is stored
  Examples:
    | id                                   |
    | an unknown UUID                      |
    | the owner's own collaboration id     |
    | a deleted product                    |
Scenario Outline: AC-4 Who may
  When <caller> sends a valid choice
  Then the answer is <answer>
  Examples:
    | caller                                | answer                |
    | a manager, a seller or a driver       | 403 `FORBIDDEN`       |
    | a person who is not signed in         | 401 `UNAUTHORIZED`    |
    | a person outside the business         | 404 `NOT_FOUND`       |
Scenario: AC-5 The body
  When it has an unknown field, 101 ids, a repeated id or an id that is not a UUID
  Then the answer is 400 `VALIDATION_ERROR` with field paths and no value
Scenario: AC-6 A repeat
  When the same `id` is sent twice
  Then both answers are equal and one event exists
```

## Abuse cases
```gherkin
Scenario: AB-1 An owner names the seats and products of another business (broken access control)
  When the owner of business A sends ids that belong to business B
  Then the answer is 404 `NOT_FOUND` and no event is stored
```

## Implementation
- Create: `src/modules/billing/billing.owner.routes.ts`, `src/modules/billing/keep-choice.service.ts`, `tests/integration/billing/keep-choice.test.ts`
- Modify: `src/app.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `saveKeepChoice(actor: OrganizationActor, input: KeepChoiceInput): Promise<KeepChoiceView>`
- Types:
  - `KeepChoiceInput = { id: string; collaborationIds: string[]; productIds: string[] }`
  - `KeepChoiceView = { collaboration_ids: string[]; product_ids: string[] }`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `zod`, `express`

## Security
- v5.0.0-8.2.1: only an owner passes the two `keep` checks, and the business comes from the session actor.
- v5.0.0-15.3.3: the body lists its writable fields and refuses any other.
- v5.0.0-2.2.1: lists have a maximum of 100 and every id is checked against the business.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| stored | integration | AC-1, C-55 | 201 and the event |
| later | integration | AC-2 | two events |
| not the business's | integration | AC-3 | each Examples row → 404, no event |
| who may | integration | AC-4 | each Examples row → answer |
| body | integration | AC-5 | extra field, 101 ids, repeat, bad UUID → 400 |
| repeat | integration | AC-6 | same id → equal answers, one event |
| other business | security | AB-1, CWE-639 | B's ids → 404, no event |

Command: `npx vitest run tests/integration/billing/keep-choice.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the keep-choice path | add POST /api/v1/organizations/{organizationId}/billing/keep-choice, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the keep-choice path | add POST /api/v1/organizations/{organizationId}/billing/keep-choice, remove nothing |

## Out of scope
- Applying the choice: BIL-019 for collaborators and BIL-020 for products.
- Swapping one seat or product online at once: BIL-029 and BIL-030.
