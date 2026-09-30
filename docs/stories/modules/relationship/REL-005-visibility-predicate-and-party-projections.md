---
id: REL-005
title: Visibility predicate and party projections
module: relationship
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [REL-002, ORG-005]
read_first: [docs/stories/modules/organization/contracts.md, prisma/schema.prisma]
design_refs: [relations-commerciales/customerrelationship, identite-et-organisation/person]
constraints: [CM-19, CM-20]
asvs: [v5.0.0-8.2.2, v5.0.0-8.2.3, v5.0.0-8.4.1, v5.0.0-15.3.1]
---

# REL-005 — Visibility predicate and party projections

## Story
Technical story: provide the one predicate that says which relationships a viewer may see and the projections that give each party only its own fields.

## Context
- Exists: `customer_relationships` (REL-001, REL-002); `toPublicPerson`.
- Adds: `src/modules/relationship/relationship.visibility.ts`.
- `visibleRelationsWhere({ personId, organizationIds })` returns a Prisma filter: live rows (`deleted_at` and `merged_into_id` null) where the supplier or customer organization is in `organizationIds`, or `customer_person_id` = `personId`, or `supplier_person_id` = `personId`.
- `projectForSupplier` returns `id, status, customer (public person view or organization name), customer_label, supplier_notes, delivery_address, credit_limit, credit_limit_set_by_id, credit_limit_set_at, balance, ended_by_party, created_at`; `projectForCustomer` returns `id, status, supplier (organization name and description, or person public view), supplier_label, delivery_address, credit_limit, balance, ended_by_party, created_at`; `projectForDriver` returns `id, customer name, available_credit` (limit minus balance, null when there is no ceiling).
- `CM-19`: `customer_label` and `supplier_notes` are never sent to the customer; `supplier_label` is never sent to the supplier; each party writes only its own fields.
- `CM-20`: An organization receives from a person only the public name, the number and whether they are registered.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Who sees a row
  Given a relationship between supplier organization S and customer person C
  When the viewer is <viewer>
  Then the row is <result>
  Examples:
    | viewer                                        | result  |
    | a member of S                                 | visible |
    | C                                             | visible |
    | a member of another organization              | hidden  |
    | another person                                | hidden  |
    | the supplier person of a PENDING invitation   | visible |
    | S when the row is deleted or merged           | hidden  |
Scenario: AC-2 Supplier projection
  Then it contains customer_label and supplier_notes and does not contain supplier_label
Scenario: AC-3 Customer projection
  Then it contains supplier_label and does not contain customer_label or supplier_notes
Scenario: AC-4 Driver projection
  When the limit is 50000 and the balance 40000
  Then available_credit is 10000 and neither credit_limit nor balance is present
  And with no ceiling available_credit is null
```

## Abuse cases
```gherkin
Scenario: AB-1 Reading another organization's relationships (horizontal)
  When a viewer of organization A applies the predicate to a table holding B's rows
  Then no row of B is returned
Scenario: AB-2 Private fields of the other party (information disclosure)
  When any projection is serialized
  Then none of the other party's private fields appears
```

## Implementation
- Create: `src/modules/relationship/relationship.visibility.ts`, `tests/integration/relationship/visibility.test.ts`
- Pattern: `src/modules/tasks/tasks.repository.ts`
- Signatures:
  - `visibleRelationsWhere(viewer: { personId: string; organizationIds: string[] }): Prisma.CustomerRelationshipWhereInput`
  - `projectForSupplier(row: RelationshipRow): SupplierRelationshipView`
  - `projectForCustomer(row: RelationshipRow): CustomerRelationshipView`
  - `projectForDriver(row: RelationshipRow): DriverRelationshipView`
- Types:
  - `DriverRelationshipView = { id: string; customer_name: string | null; available_credit: number | null }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: one predicate for every consumer.
- v5.0.0-8.2.3: projections are built from explicit field lists.
- v5.0.0-8.4.1: an empty `organizationIds` matches no organization row.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| who sees | integration | AC-1 | each Examples row → visible or hidden |
| supplier view | unit | AC-2, CM-19, CM-20 | keys checked; the customer person part has exactly public_name, phone_number, registered |
| customer view | unit | AC-3, CM-19 | keys checked |
| driver view | unit | AC-4 | available_credit arithmetic; no limit or balance |
| other organization | security | AB-1, WSTG-ATHZ-04 | no foreign rows |
| private fields | security | AB-2, CWE-200 | serialized views lack the other side's fields |

Command: `npx vitest run tests/integration/relationship/visibility.test.ts`

## Out of scope
- Routes that use it (REL-008 onward).
