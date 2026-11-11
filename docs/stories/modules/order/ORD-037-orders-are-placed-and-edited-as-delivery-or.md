---
id: ORD-037
title: Orders are placed and edited as delivery or pickup
module: order
kind: change
rev: 1
amends: [ORD-007, ORD-009, ORD-010, ORD-013, ORD-014]
size: S
risk: medium
depends_on: [ORD-036]
read_first: [src/modules/order/order.schemas.ts, tests/integration/order/order-line-variant-required.test.ts]
design_refs: [a4-livraison-ou-retrait-reception-mode/champ-ajoute-a-order]
constraints: [C-60]
asvs: [v5.0.0-2.2.1, v5.0.0-15.3.3]
---

# ORD-037 — Orders are placed and edited as delivery or pickup

## Story
As a customer, I want to say whether my order is delivered or picked up, so that nobody delivers an order I come to fetch.

## Context
- Exists: column `reception_mode` and its check (ORD-036); bodies of POST /api/v1/orders (ORD-009), POST /api/v1/organizations/{organizationId}/purchases (ORD-010), POST /api/v1/organizations/{organizationId}/orders (ORD-013), PATCH /api/v1/organizations/{organizationId}/orders/{orderId} (ORD-014); views (ORD-007).
- The four bodies get an optional `reception_mode`, DELIVERY or PICKUP. Absent at creation, the order keeps it empty (older app versions).
- Creation: PICKUP stores no address and never applies the relationship's usual address; PICKUP with a `delivery_address` that is not null → 400 VALIDATION_ERROR; DELIVERY or absent → today's address rule.
- Edit: absent → the mode does not change; PICKUP clears the address; DELIVERY on an order whose stored mode is not DELIVERY, with no address sent, applies the usual address; an address sent while the resulting mode is PICKUP → 400 VALIDATION_ERROR, nothing changes.
- One pure helper decides mode and address for both gestures. The customer and supplier views show `reception_mode` (null when not stated).
- The field informs only: departure, driver and delivery rules do not change.
- `C-60`: A `PICKUP` order has no delivery address.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Placing an order with a reception mode
  Given a relationship whose usual address is "Rue 12, Akwa"
  When the customer places an order with <mode> and <address>
  Then the response is <response>
  Examples:
    | mode                 | address            | response                                              |
    | PICKUP               | none               | 201, reception_mode PICKUP, no address                |
    | PICKUP               | "Rue 7, Bonapriso" | 400 VALIDATION_ERROR, nothing stored                  |
    | DELIVERY             | none               | 201, reception_mode DELIVERY, address "Rue 12, Akwa"  |
    | no reception_mode    | none               | 201, reception_mode null, address "Rue 12, Akwa"      |
Scenario: AC-2 Same rules for a purchase and a seller's entry
  When a manager places a purchase, or a seller enters an order, with PICKUP and no address
  Then the order is stored with PICKUP and no address
Scenario: AC-3 Editing to pickup clears the address
  When the seller edits an order with address "Rue 12, Akwa" to PICKUP
  Then the order has PICKUP and no address
Scenario: AC-4 Editing back to delivery applies the usual address
  When the seller edits a PICKUP order to DELIVERY without an address
  Then the order has DELIVERY and address "Rue 12, Akwa"
Scenario: AC-5 An address on a pickup is refused
  When the seller edits a PICKUP order sending only `delivery_address`
  Then the response is 400 VALIDATION_ERROR and the order is unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 An unknown mode
  When a body carries `reception_mode` 'SHIP'
  Then the response is 400 VALIDATION_ERROR whose details name the field and the rule, never the value
```

## Implementation
- Create: `tests/integration/order/reception-mode.test.ts`
- Modify: `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.repository.ts`, `src/modules/order/order.views.ts`, `src/modules/order/order.openapi.ts`
- Pattern: `tests/integration/order/order-line-variant-required.test.ts`
- Signatures:
  - `resolveReception(sent: { mode?: ReceptionMode; address?: string | null }, stored: { mode: ReceptionMode | null; address: string | null } | null, usualAddress: string | null): { receptionMode: ReceptionMode | null; deliveryAddressApplied: string | null }`
- Errors: `VALIDATION_ERROR` 400
- Dependencies: `zod`, `@prisma/client`

## Security
- v5.0.0-15.3.3: `reception_mode` is added to the listed writable fields; the strict schemas still reject any other field.
- v5.0.0-2.2.1: the mode and address rule is checked on the server for every gesture, the check of ORD-036 backing it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| place modes | integration | AC-1, C-60 | each Examples row → stored mode and address, or 400 |
| other routes | integration | AC-2, C-60 | purchase and seller entry with PICKUP → no address |
| edit to pickup | integration | AC-3 | address cleared |
| edit to delivery | integration | AC-4 | usual address applied |
| address on pickup | integration | AC-5, C-60 | 400, order unchanged |
| unknown mode | security | AB-1, WSTG-INPV-20 | 'SHIP' → 400, details without the value |

Command: `npx vitest run tests/integration/order/reception-mode.test.ts tests/unit/order/calculations-and-views.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/order/calculations-and-views.test.ts | asserts the exact keys of the order views | the keys also include `reception_mode` |

## Out of scope
- Reorder (« Reprendre une commande ») is built on the phone: no server change.
- The rest order (DLV-018), the replaced version (ORD-039) and orders created through sync (SYNC-049).
