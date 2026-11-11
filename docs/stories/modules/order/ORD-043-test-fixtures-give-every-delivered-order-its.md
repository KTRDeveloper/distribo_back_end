---
id: ORD-043
title: Test fixtures give every delivered order its receipt
module: order
kind: technical
rev: 1
amends: []
size: S
risk: low
depends_on: [DLV-019]
read_first: [src/modules/order/order.state.ts, tests/integration/order/order-line-variant-required.test.ts]
design_refs: [a8-le-recu-ne-change-plus-point-9/contraintes-de-base-de-donnees-complete]
constraints: []
asvs: [v5.0.0-2.2.1]
---

# ORD-043 — Test fixtures give every delivered order its receipt

## Story
Technical story: test fixtures that write a delivered order also write its receipt, so that the suite stays green once the database requires it (ORD-045).

## Context
- Since DLV-019 the delivery code writes the four receipt fields with DELIVERED; ORD-045 will make the database refuse a DELIVERED order without them.
- Create `tests/helpers/receipt-fields.ts` exporting `RECEIPT_FIELDS` (`supplierNameApplied: 'Test supplier'`, `customerNameApplied: null`, `collectedApplied: 0n`, `balanceAfterApplied: 0n`).
- In each test under Tests to update, a fixture that creates or updates an order as DELIVERED spreads `RECEIPT_FIELDS`, and a direct `transitionOrder` call to DELIVERED passes `{ receipt: RECEIPT_FIELDS }`. A file without such a fixture stays as it is.
- No assertion and no production file changes.

## Acceptance criteria
```gherkin
Scenario: AC-1 The helper
  When an order is created as DELIVERED with RECEIPT_FIELDS
  Then its four receipt fields hold the helper's values
Scenario: AC-2 The suite is unchanged
  When npm test runs
  Then the same tests pass as before, with the same assertions
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/helpers/receipt-fields.ts`, `tests/integration/order/receipt-fields-helper.test.ts`
- Pattern: `tests/integration/order/order-line-variant-required.test.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.1: fixtures follow the rule the database will enforce, so no test needs it relaxed.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| helper | integration | AC-1 | the four values stored |
| suite | integration | AC-2 | npm test green, assertions unchanged |

Command: `npx vitest run tests/integration/order/receipt-fields-helper.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/delivery/abandoned-rests.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/delivery/counter-sale.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/delivery/deliver.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/delivery/depart.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/delivery/driver-lists.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/delivery/fail.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/delivery/partial-delivery.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/delivery/unsettled.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/accept-order.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/accepted-at.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/cancel-order-customer.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/cancel-order-supplier.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/close-refuses-pending.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/edit-order.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/order-note.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/order-table.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/refuse-order.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/state-machine.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/status-rules.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/order/total-check.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/sync/controls-credit.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/sync/exceptions.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/sync/issues.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/sync/pull-catalog.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/sync/pull-orders.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/sync/push-closing.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/sync/push-deliveries.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/sync/rights-change.test.ts | may write a DELIVERED order | its fixture gives the receipt |
| tests/integration/sync/rights-paused.test.ts | may write a DELIVERED order | its fixture gives the receipt |

## Out of scope
- The database rule (ORD-045).
