---
id: SYNC-042
title: The driver receives the contacts of the client businesses to deliver
module: sync
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [SYNC-036, SYNC-040]
read_first: [src/modules/sync/adapters/contacts.adapter.ts, src/modules/sync/adapters/relationship.adapter.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, identite-et-organisation/organizationcontact]
constraints: [C-35]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# SYNC-042 — The driver receives the contacts of the client businesses to deliver

## Story
As a driver, I want the verified phone numbers of the businesses I deliver to on my phone, so that I can call them from the road.

## Context
- Exists: the `organization_contacts` pull for the team and the parties (SYNC-036), which gives a DRIVER nothing; the driver's relationships in `relationship.adapter.ts`: the live relationships of their organizations that have a CONFIRMED order to deliver.
- `relationship.adapter.ts` exports its driver branch as `driverRelationshipsWhere(driverOrganizationIds, personId)`, which `scopeBranches` and the contacts adapter both use.
- For a DRIVER the contacts adapter sends the verified contacts of the customer organization of each such relationship, in the same row as SYNC-036. A customer that is a person has no contacts. The driver's own business is not sent.
- Incremental pull: the contacts changed since the last pull, and in full the verified contacts of a customer organization when an order of that relationship changed since, so a newly confirmed order brings its customer's numbers. A contact that is pending again or deleted is listed in `deleted`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 A client business
  Given a customer business with two verified contacts and a pending one, and a CONFIRMED order for it with an address
  When a DRIVER of the supplier pulls
  Then they get the two verified contacts and not the pending one
Scenario: AC-2 Nothing else
  Given a customer business with no order to deliver, a particular customer with an order, and the supplier's own contacts
  When the DRIVER pulls
  Then none of their contacts is in the answer
Scenario: AC-3 A new order
  Given the customer's contacts did not change since the last pull
  When an order for it is confirmed after that pull
  Then its verified contacts arrive again whole
Scenario: AC-4 Pending again
  Given a verified contact goes back to pending after the last pull
  Then its id is in `deleted` for the driver
```

## Abuse cases
```gherkin
Scenario: AB-1 Contacts of another business (information disclosure, horizontal)
  When the DRIVER of one supplier pulls while a customer business of another supplier has verified contacts
  Then none of them is in the answer
```

## Implementation
- Create: `tests/integration/sync/pull-contacts-driver.test.ts`
- Modify: `src/modules/sync/adapters/contacts.adapter.ts`, `src/modules/sync/adapters/relationship.adapter.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Signatures:
  - `driverRelationshipsWhere(driverOrganizationIds: string[], personId: string): Prisma.CustomerRelationshipWhereInput`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the organizations come from the viewer's ACTIVE DRIVER memberships and the relationships of the driver branch, never from the request.
- v5.0.0-15.3.1: the row is the explicit list of SYNC-036.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| client business | integration | AC-1 | two verified, no pending |
| nothing else | integration | AC-2 | empty |
| new order | integration | AC-3, C-35 | sent whole |
| pending again | integration | AC-4, C-35 | deleted id |
| other business | security | AB-1, CWE-639 | absent |

Command: `npx vitest run tests/integration/sync/pull-contacts-driver.test.ts tests/integration/sync/pull-relationships.test.ts`

## Out of scope
- The contacts of the driver's own business.
