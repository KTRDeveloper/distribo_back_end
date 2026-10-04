---
id: ORD-006
title: Order total equals the sum of its lines
module: order
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ORD-005]
read_first: [prisma/schema.prisma, tests/integration/order/line-rules.test.ts]
design_refs: [commandes-et-livraisons/order, contraintes-a-poser-au-niveau-base-de]
constraints: [C-19]
asvs: [v5.0.0-2.2.3, v5.0.0-2.3.3]
---

# ORD-006 — Order total equals the sum of its lines

## Story
Technical story: make the database check, at the end of each transaction, that an order's total is the sum of its line amounts plus its delivery cost, and that a delivered order's lines all carry a delivered quantity.

## Context
- Exists: `orders.total_amount`, `orders.delivery_cost`, `order_lines.amount`, `order_lines.delivered_quantity`.
- Adds: deferred constraint triggers (initially deferred) on `orders` and `order_lines`: at commit, for every touched order, `total_amount = sum(amount of its non-deleted lines) + delivery_cost`; an order with no lines is allowed only when `total_amount = delivery_cost`; when `status = 'DELIVERED'` every non-deleted line has `delivered_quantity` set. Violation: SQLSTATE 23514 at commit.
- `C-19`: `delivered_at` and `delivered_by_id` are set if and only if `status` is DELIVERED; every line then has `delivered_quantity`; `total_amount` equals the sum of line amounts plus `delivery_cost`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Consistent order
  When one transaction inserts an order with total 33000 and lines of 15000 and 15000 with delivery_cost 3000
  Then the commit succeeds
Scenario Outline: AC-2 Inconsistent totals
  When the transaction commits an order with <case>
  Then the commit <result>
  Examples:
    | case                                                     | result          |
    | total 30000 for lines summing to 33000 with cost 0       | rejects (23514) |
    | total changed without changing a line                    | rejects (23514) |
    | a line amount changed without changing the total         | rejects (23514) |
    | an order with no lines and total_amount = delivery_cost  | accepts         |
Scenario: AC-3 Delivered needs delivered quantities
  When an order is set DELIVERED while a line has no delivered_quantity
  Then the commit fails with 23514
Scenario: AC-4 Same transaction
  When the lines and the total change together in one transaction
  Then the commit succeeds
```

## Abuse cases
```gherkin
Scenario: AB-1 A total that hides a discount (tampering)
  When code lowers `total_amount` below the sum of the lines
  Then PostgreSQL refuses the commit
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_006_total_check/migration.sql`, `tests/integration/order/total-check.test.ts`
- Update: the comment above `Order` and `OrderLine` in `prisma/schema.prisma` (CLAUDE.md rule), including the line that still says "other rules on creation (ORD-006)"
- Update: the fixtures of the files under "Tests to update"; only their setup data changes, never what a test asserts
- Pattern: `tests/integration/order/line-rules.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the total is a database invariant.
- v5.0.0-2.3.3: the check runs when the transaction ends, so lines and total may be written in any order.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| consistent | integration | AC-1 | commit passes |
| inconsistent | integration | AC-2, C-19 | each Examples row → accepted or 23514 |
| delivered quantities | integration | AC-3, C-19 | 23514 at commit |
| same transaction | integration | AC-4 | commit passes |
| hidden discount | security | AB-1, CWE-345 | commit refused |

Command: `npx vitest run tests/integration/order/total-check.test.ts`

### Tests to update
Each of these tests builds orders that break the new rule: an order with a total and no lines, or lines added to an order whose total stays 0, each committed on its own. Change only the setup data. Each test keeps its name and what it asserts, and a refusal it expects must still come from the rule it is about, not from the totals check.

| existing test | reason | new expectation |
|---|---|---|
| tests/integration/finance/ledger-table.test.ts › every test (28) | `beforeEach` inserts an order with `total_amount` 10000 and no lines, which the totals check refuses with 23514 | the fixture order has `total_amount` 0 (no lines, `delivery_cost` 0); every test passes unchanged |
| tests/integration/order/line-rules.test.ts › tests that insert or update a valid line (9: product rule "accepts an ACTIVE product of the supplier"; minimum quantity "CUSTOMER at the minimum", "SUPPLIER below", "accepts any quantity on a product without a minimum"; later changes "updates delivered_quantity after the product became INACTIVE or its minimum rose", "keeps the customer-order line updatable after the product was deleted"; customer order prices "accepts a supplier-order line with a price gap and its author", "refuses a raise above the reference and accepts a lowering", "refuses raising the reference price out from under a lowered price") | `insertOrder` sets `total_amount` 0, so inserting a line, or changing its `amount`, leaves the total wrong at commit (23514) | inserting or updating a line and moving the order's `total_amount` by the same amount happen in one transaction; accepted rows are still accepted, refused rows still refused with the same code |
| tests/integration/order/order-line-table.test.ts › tests that insert or update a valid line (8: amount rule rows q=2.5, q=10 and q=0.001 accepted=true, "uses the expected column types, defaults and server_updated_at", "rejects an amount that no longer matches after an update"; price gap "accepts a gap with author and time", "accepts an equal price with no author"; customer-placed orders "accepts a line at the reference price and rejects any gap without an author") | same cause: `insertOrder` sets `total_amount` 0 and lines are inserted or updated on their own | same fix as line-rules: the line and the order total change in one transaction; same expectations |
| tests/integration/order/order-table.test.ts › "moves server_updated_at forward on update" | it updates `total_amount` to 5 on an order without lines | the update sets `total_amount` and `delivery_cost` to 5 together; `server_updated_at` still moves forward |
| tests/integration/order/status-rules.test.ts › "leaves a non-frozen order free to change other columns" | it sets `delivery_cost` 500 without changing `total_amount` | the same update also raises `total_amount` by 500; still 1 row |
| tests/integration/relationship/contest.test.ts › "AC-3 keeps balance, orders and ledger entries on the same relationship" | it creates an order with `totalAmount` 5000 and no lines | the order also has `deliveryCost` 5000 (or a total of 0); same assertions |
| tests/integration/sync/pull-catalog.test.ts › every test (7) | `seedOrderLine` creates an order with `totalAmount` 0, then a line of 37500 in a separate statement, so the order total is wrong at commit (23514) | `seedOrderLine` creates the order with `totalAmount` 37500 and its line in one write (a nested `lines: { create }` or one transaction); every test passes unchanged |
| tests/integration/sync/pull-orders.test.ts › every test (11) | `seedOrder` creates an order with `totalAmount` 10000 and no line, then its line in a separate statement (23514 at the first commit), and its DELIVERED orders' lines have no `deliveredQuantity` | `seedOrder` creates the order and its line in one write; a DELIVERED order's line has `deliveredQuantity` 2 (amount still 10000); every test passes unchanged, `total_amount` 10000 included |
| tests/integration/sync/pull-orders.test.ts › "owner and manager: the price author on lines, the seller never (AC-1, v5.0.0-8.2.3)" | it lowers the line amount to 8000 without changing the order total | the same transaction sets the order's `totalAmount` to 8000; same assertions |
| tests/integration/sync/pull-orders.test.ts › "lines: a deleted line is listed by id on an incremental pull (C-35)" | soft-deleting the order's only line leaves a total of 10000 over no lines; updating the total in the same transaction would put the order in `orders.updated`, which the test asserts is empty | the line it deletes is worth 0 before the first pull: the IN_DELIVERY order is seeded with that line at reference and applied price 0, amount 0, and `totalAmount` 0 (prices may be 0); the soft delete then leaves the total valid without touching the order; same assertions, `orders.updated` still `[]` |

## Out of scope
- Computing totals in code (ORD-007).
