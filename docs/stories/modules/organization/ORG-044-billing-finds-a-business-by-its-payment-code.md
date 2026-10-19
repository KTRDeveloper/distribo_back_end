---
id: ORG-044
title: Billing finds a business by its payment code and its owner
module: organization
kind: technical
rev: 1
amends: []
size: XS
risk: low
depends_on: [ORG-020, ORG-035]
read_first: [src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/organization]
constraints: [C-41]
asvs: [v5.0.0-8.2.1]
---

# ORG-044 — Billing finds a business by its payment code and its owner

## Story
Technical story: let billing find a business from the code typed on the payment site, and find its owner, through functions of the organization contract.

## Context
- Exists: `payment_code`, unique (ORG-020); `findActiveOwnerId(tx, organizationId)` in `organization.repository.ts`, not yet in the contract.
- Adds `findOrganizationByPaymentCode(code, tx?)`: the id, name and status of the non-deleted organization whose `payment_code` equals `code` exactly, else null. It does not trim or change case: the caller does (BIL-007).
- Adds `findOrganizationSummary(organizationId, tx?)`: the same three fields by id, null when absent or deleted.
- The contract lists these three functions for billing. Shipped before their callers; the tests call them directly.
- `C-41`: `Organization.payment_code` is unique; `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only; `plan = FREE` exactly when `plan_ends_at` is empty; a set `grace_ends_at` is after `plan_ends_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 A code finds its business
  When `findOrganizationByPaymentCode` receives the exact code of a business
  Then it returns that business's id, name and status
Scenario Outline: AC-2 No business
  When `findOrganizationByPaymentCode` receives <code>
  Then it returns null
  Examples:
    | code                                  |
    | a code that no business holds         |
    | the code of a deleted business        |
    | the right code in lower case          |
Scenario: AC-3 Summary and owner
  When `findOrganizationSummary` and `findActiveOwnerId` run for a business, and the first runs for a deleted one
  Then they return its id, name and status and its OWNER's person id, and null for the deleted one
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/organization/payment-code-lookup.test.ts`
- Modify: `src/modules/organization/organization.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `findOrganizationByPaymentCode(code: string, tx?: Prisma.TransactionClient): Promise<OrganizationSummary | null>`
  - `findOrganizationSummary(organizationId: string, tx?: Prisma.TransactionClient): Promise<OrganizationSummary | null>`
- Types:
  - `OrganizationSummary = { id: string; name: string; status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' }`
- Dependencies: none added

## Security
- v5.0.0-8.2.1: the functions return three fields and nothing of the plan or the team; no route exposes it before BIL-007.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| found | integration | AC-1, C-41 | exact code → id, name, status |
| absent | integration | AC-2 | each Examples row → null |
| summary and owner | integration | AC-3 | summary, OWNER id, null for a deleted business |

Command: `npx vitest run tests/integration/organization/payment-code-lookup.test.ts`

## Out of scope
- Reading the code typed by a person and the route: BIL-007.
