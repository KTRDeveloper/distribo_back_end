---
id: DLV-003
title: Driver sees the orders to deliver
module: delivery
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [DLV-002, REL-005, ORD-007]
read_first: [src/modules/relationship/relationship.visibility.ts, src/modules/order/order.views.ts]
design_refs: [commandes-et-livraisons/delivery, relations-commerciales/customerrelationship/plafond-de-credit-une-seule-regle]
constraints: []
asvs: [v5.0.0-8.2.2, v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# DLV-003 — Driver sees the orders to deliver

## Story
As a driver, I want to see the orders to deliver and my own deliveries so that I know what to take.

## Context
- Exists: `projectForDriver` (REL-005); orders (ORD module); `loadActor`.
- Adds: `GET /api/v1/organizations/{organizationId}/deliveries/to-deliver` (DRIVER and above): CONFIRMED orders of the organization with a `delivery_address_applied`, not deleted, newest first, paginated; item `{ order_id, delivery_address, desired_delivery_date, customer_note, total_amount, lines: [{ label, quantity, unit_price_applied, amount }], customer: DriverRelationshipView }`.
- `GET /api/v1/organizations/{organizationId}/deliveries/mine?status=in_progress|done|failed` (DRIVER and above): the caller's own deliveries with the same order fields, `departed_at`, `arrived_at`, `failed_at`, `failure_reason`.
- The customer part is `projectForDriver`: name, `available_credit`; never balance, limit, notes or the ledger. Adds `delivery.openapi.ts` documenting these routes and later delivery routes; `delivery.routes.ts` imports it.

## Acceptance criteria
```gherkin
Scenario: AC-1 To deliver
  Given 2 CONFIRMED orders with an address, 1 without, 1 PENDING and 1 DELIVERED
  When a DRIVER lists to-deliver
  Then only the 2 orders with an address are returned
Scenario: AC-2 Available credit only
  Given a customer with limit 50000 and balance 40000
  Then the driver sees available_credit 10000 and no balance, limit or notes
Scenario: AC-3 Mine
  When a driver lists their deliveries
  Then only rows assigned to them appear, filtered by status
Scenario: AC-4 All drivers see the pool
  Then every ACTIVE driver of the organization sees the same to-deliver list
Scenario: AC-5 Pagination
  When limit 1 is used with the cursor
  Then pages follow without repeats
```

## Abuse cases
```gherkin
Scenario: AB-1 Debt of a customer (information disclosure)
  When a driver reads any of these responses
  Then no balance, credit_limit, supplier_notes or ledger data appears
Scenario: AB-2 Another business's orders (horizontal)
  When a member of A requests business B
  Then the response is 404
```

## Implementation
- Create: `src/modules/delivery/delivery.routes.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.openapi.ts`, `src/modules/delivery/delivery.repository.ts`, `tests/integration/delivery/driver-lists.test.ts`
- Modify: `src/app.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `listToDeliver(actor: Actor, query: PageQuery): Promise<{ items: ToDeliverItem[]; next_cursor: string | null }>`
  - `listMyDeliveries(actor: Actor, query: MineQuery): Promise<{ items: MyDeliveryItem[]; next_cursor: string | null }>`
- Errors: `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.2: queries start from the actor's organization.
- v5.0.0-8.2.3: the customer part comes only from `projectForDriver`.
- v5.0.0-15.3.1: explicit fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| to deliver | integration | AC-1 | two orders |
| credit only | integration | AC-2 | 10000, no balance |
| mine | integration | AC-3 | own rows and filter |
| pool | integration | AC-4 | same list for two drivers |
| paging | integration | AC-5 | no repeats |
| debt hidden | security | AB-1, CWE-200 | fields absent |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/delivery/driver-lists.test.ts`

## Out of scope
- Assigning, departing and delivering (DLV-004 onward).
