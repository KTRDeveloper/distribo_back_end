---
id: ORD-001
title: Orders table
module: order
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [REL-002, PER-008, FND-005]
read_first: [prisma/schema.prisma, tests/integration/relationship/relationship-table.test.ts]
design_refs: [commandes-et-livraisons/order, contraintes-a-poser-au-niveau-base-de]
constraints: ['Order:required', 'Order.placed_by_party:enum', 'Order.status:enum', 'Order.cancelled_by_party:enum', 'Order:fk', C-35, C-04, C-01]
asvs: [v5.0.0-2.2.3]
---

# ORD-001 — Orders table

## Story
Technical story: create the orders table with its columns and keys so that orders can be stored.

## Context
- Exists: `customer_relationships`, `require_registered_person()`, `set_server_updated_at()`.
- Adds: table `orders` (Prisma model `Order`, table name `orders`; `total_amount` and `delivery_cost` bigint, `delivery_cost` default 0, `status` default CONFIRMED, `created_at` default now, `server_updated_at`, `deleted_at`), foreign keys including `parent_order_id` to itself, indexes on `customer_relationship_id`, `status`, and (`delivered_by_id`, `delivered_at`), and triggers `require_registered_person('entered_by_id', 'delivered_by_id', 'cancelled_by_id')` and `set_server_updated_at()`.
- State, cancellation, delivery and creation rules follow in ORD-002, ORD-003 and ORD-006.
- `Order` fields: `customer_relationship_id` FK → CustomerRelationship; `placed_by_party` enum [CUSTOMER / SUPPLIER]; `entered_by_id` FK → Person; `delivery_address_applied` string, nullable; `total_amount` bigint; `delivery_cost` bigint; `status` enum [PENDING / CONFIRMED / IN_DELIVERY / DELIVERED / CANCELLED]; `delivered_at` datetime, nullable; `delivered_by_id` FK → Person, nullable; `created_at` datetime; `desired_delivery_date` date, nullable; `cancelled_by_party` enum [CUSTOMER / SUPPLIER], nullable; `cancelled_by_id` FK → Person, nullable; `cancelled_at` datetime, nullable; `cancellation_reason` string, nullable; `parent_order_id` FK → Order, nullable; `customer_note` string, nullable; `supplier_note` string, nullable; `sync_issue` string, nullable
- `Order:required`: NOT NULL: `customer_relationship_id`, `placed_by_party`, `entered_by_id`, `total_amount`, `delivery_cost`, `status`, `created_at`
- `Order.placed_by_party:enum`: one of CUSTOMER, SUPPLIER
- `Order.status:enum`: one of PENDING, CONFIRMED, IN_DELIVERY, DELIVERED, CANCELLED
- `Order.cancelled_by_party:enum`: one of CUSTOMER, SUPPLIER
- `Order:fk`: references customer_relationship_id → CustomerRelationship; entered_by_id → Person; delivered_by_id → Person; cancelled_by_id → Person; parent_order_id → Order
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Order defaults
  When an order is inserted with a relationship, placed_by_party SUPPLIER, entered_by_id and total_amount 0
  Then `delivery_cost` is 0, `status` is CONFIRMED, and `created_at` and `server_updated_at` are set
Scenario Outline: AC-2 Enums and keys
  When a row has <values>
  Then the insert <result>
  Examples:
    | values                                   | result          |
    | status "LATE"                            | rejects         |
    | placed_by_party "ADMIN"                  | rejects         |
    | cancelled_by_party "PLATFORM"            | rejects         |
    | an unknown relationship                  | rejects (23503) |
    | entered_by_id of a guest                 | rejects (23514) |
    | parent_order_id of an existing order     | accepts         |
Scenario: AC-3 Required
  When placed_by_party, entered_by_id or total_amount is null
  Then the insert fails with 23502
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_001_orders/migration.sql`, `tests/integration/order/order-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/relationship/relationship-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: enums, keys and author checks are enforced by the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| defaults | integration | AC-1, C-01, C-35 | insert → defaults; column types |
| enums and keys | integration | AC-2, Order.placed_by_party:enum, Order.status:enum, Order.cancelled_by_party:enum, Order:fk, C-04 | each Examples row → accepted or rejected |
| required | integration | AC-3, Order:required | null → 23502 |

Command: `npx vitest run tests/integration/order/order-table.test.ts`

## Out of scope
- Order rules in the database (ORD-002, ORD-003, ORD-006).
