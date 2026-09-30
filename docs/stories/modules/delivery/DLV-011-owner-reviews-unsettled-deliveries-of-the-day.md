---
id: DLV-011
title: Owner reviews unsettled deliveries of the day
module: delivery
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [DLV-008, FIN-019]
read_first: [src/modules/delivery/delivery.service.ts, src/modules/finance/finance.service.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, finances/handover]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# DLV-011 — Owner reviews unsettled deliveries of the day

## Story
As an owner, I want each driver's deliveries that were not fully paid on a given day so that I can call the customer if in doubt.

## Context
- Exists: delivered orders and PAYMENT entries with `order_id`.
- Adds: `GET /api/v1/organizations/{organizationId}/exceptions/unsettled-deliveries?date=YYYY-MM-DD` (OWNER only; the day is read in the Africa/Douala time zone; default today). Response `{ items: [{ driver_person_id, orders: [{ order_id, customer_label, total_amount, collected_amount, unpaid_amount }] }] }`: orders delivered that day by a DRIVER-role collaborator or any non-owner whose collected payments for the order are below `total_amount`.
- `collected_amount` is the sum of PAYMENT entries with that `order_id` (reversals subtract).

## Acceptance criteria
```gherkin
Scenario: AC-1 Unsettled orders grouped by driver
  Given Paul delivered 3 orders on the day, 2 fully paid and 1 collected 24000 of 30000
  When the owner reads that day
  Then one item for Paul lists the one order with unpaid_amount 6000
Scenario: AC-2 Day boundaries
  Then an order delivered at 23:30 Douala time belongs to that day, and one at 00:10 the next day does not
Scenario Outline: AC-3 Validation and roles
  When the request has <case>
  Then the response is <status>
  Examples:
    | case                       | status |
    | a MANAGER caller           | 403    |
    | date "31/12/2026"          | 400    |
Scenario: AC-4 Owner's own deliveries
  Then orders delivered by the owner are not listed
```

## Abuse cases
```gherkin
Scenario: AB-1 Unpaid deliveries hidden from the owner (repudiation)
  When a driver delivers on credit without collecting
  Then the order appears with its full total as unpaid
Scenario: AB-2 Another business (horizontal)
  When a member of A requests business B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/delivery/unsettled.test.ts`
- Modify: `src/modules/delivery/delivery.routes.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.repository.ts`, `src/modules/delivery/delivery.schemas.ts`, `src/modules/delivery/delivery.openapi.ts`
- Pattern: `src/modules/delivery/delivery.routes.ts`
- Signatures:
  - `unsettledDeliveries(actor: Actor, query: { date?: string }): Promise<{ items: UnsettledItem[] }>`
- Errors: `FORBIDDEN` 403, `VALIDATION_ERROR` 400, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: owner only.
- v5.0.0-15.3.1: person ids, labels and amounts only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| unsettled | integration | AC-1 | one order, 6000 |
| day boundaries | integration | AC-2 | Douala time zone |
| validation and roles | integration | AC-3 | each Examples row → status |
| owner excluded | integration | AC-4 | none |
| hidden credit | security | AB-1, CWE-778 | listed |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/delivery/unsettled.test.ts`

## Out of scope
- A separate table: this is a read.
