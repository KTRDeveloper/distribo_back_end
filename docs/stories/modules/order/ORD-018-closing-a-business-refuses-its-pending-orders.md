---
id: ORD-018
title: Closing a business refuses its pending orders
module: order
kind: change
rev: 1
amends: [ORG-016]
size: S
risk: medium
depends_on: [ORD-008, ORG-016]
read_first: [src/modules/organization/organization.service.ts, src/modules/order/order.state.ts]
design_refs: [identite-et-organisation/organization]
constraints: [CM-10]
asvs: [v5.0.0-2.3.3]
---

# ORD-018 — Closing a business refuses its pending orders

## Story
Technical story: refuse every PENDING order of a business when its owner closes it, so that no customer waits for a closed business.

## Context
- Exists: `closeOrganization` (ORG-016), `transitionOrder` (ORD-008), `notify`.
- Changes: in the same transaction as the close, every PENDING order whose relationship has this organization as supplier is cancelled with `cancelled_by_party` SUPPLIER, `cancelled_by_id` the owner, `cancellation_reason` "Commerce fermé"; each customer is notified `order.status_changed`. CONFIRMED and IN_DELIVERY orders are untouched.
- `CM-10`: CLOSED (by the owner, reopenable): no new order or customer, not findable by number, pending orders refused with reason 'Commerce fermé', team revoked, subscription stopped; relations, balances and history stay visible and payments stay possible.

## Acceptance criteria
```gherkin
Scenario: AC-1 Pending orders refused
  Given 2 PENDING, 1 CONFIRMED and 1 DELIVERED order of the business
  When the owner closes it
  Then the 2 PENDING orders are CANCELLED with reason "Commerce fermé" and the others are unchanged
Scenario: AC-2 Customers told
  Then each customer of a refused order has one unread `order.status_changed`
Scenario: AC-3 Atomic
  When a refusal fails
  Then the organization is still ACTIVE and every order unchanged
Scenario: AC-4 No pending orders
  Then closing works as before
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/order/close-refuses-pending.test.ts`
- Modify: `src/modules/organization/organization.service.ts`, `src/modules/order/order.repository.ts`
- Pattern: `src/modules/order/order.repository.ts`
- Signatures:
  - `refusePendingOrders(tx: Prisma.TransactionClient, organizationId: string, byPersonId: string): Promise<number>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: close and refusals are one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| pending refused | integration | AC-1, CM-10 | statuses and reason |
| customers told | integration | AC-2 | notifications |
| atomic | integration | AC-3, CWE-362 | forced failure → unchanged |
| no pending | integration | AC-4 | as before |

Command: `npx vitest run tests/integration/order/close-refuses-pending.test.ts tests/integration/organization/close.test.ts`

## Out of scope
- Orders already confirmed or delivered.
