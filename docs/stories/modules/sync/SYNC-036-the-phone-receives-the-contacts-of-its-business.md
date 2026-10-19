---
id: SYNC-036
title: The phone receives the contacts of its business and of the businesses it deals with
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [SYNC-024, ORG-021, REL-001]
read_first: [src/modules/sync/adapters/identity.adapter.ts, src/modules/relationship/relationship.visibility.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, identite-et-organisation/organizationcontact]
constraints: [C-35]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# SYNC-036 — The phone receives the contacts of its business and of the businesses it deals with

## Story
As a seller, I want the verified contacts of my customers and suppliers on my phone, so that I can call them without network.

## Context
- Exists: `organization_contacts` with `kind`, `slot`, `value`, `verified_at`, `verification_method`, `server_updated_at`, `deleted_at` (ORG-021); `classifyChanges` and `toEpoch` (SYNC-001); `visibleRelationsWhere` (REL-001).
- `organization_contacts` joins `SYNC_TABLES` (16 tables), with its adapter in a new `adapters/contacts.adapter.ts`, registered from `sync.routes.ts`. Its push refuses every line `SYNC_TABLE_READ_ONLY`: contacts are written by online routes only.
- A row is `id, organization_id, kind, slot, value, verified_at, verification_method, created_at, server_updated_at`; never `created_by_id`.
- Team (ACTIVE OWNER, MANAGER or SELLER): every contact of its organizations, verified or pending. A DRIVER does not get its own business's contacts here (SYNC-042).
- Parties: for each relationship the viewer sees (`visibleRelationsWhere`, given the organizations where they are OWNER, MANAGER or SELLER, never those where they are DRIVER; any status) the organization on the other side, whatever its status (ACTIVE, SUSPENDED, CLOSED): its verified contacts only. A particular customer gets those of its suppliers. A contact that is pending again or deleted is listed in `deleted`. The contacts of an organization made visible by a relationship created since the last pull are sent whole.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 The team
  Given the business has a verified phone, a verified email and a pending phone
  When its OWNER, a MANAGER and a SELLER pull
  Then each gets all three, with `verified_at` null on the pending one
Scenario: AC-2 The other side
  Given a customer business and a particular customer, both with a relationship with the business
  When each pulls
  Then each gets the two verified contacts of the business and not the pending one
Scenario: AC-3 A closed or suspended business
  Given the supplier is CLOSED
  Then its customers still receive its verified contacts, and its team those of the customer business
Scenario: AC-4 Pending again
  Given a verified contact goes back to pending after the last pull
  Then its team gets it in `updated` with `verified_at` null, and the other side gets its id in `deleted`
Scenario: AC-5 A new relationship
  Given a relationship is created after the last pull
  Then the other side's verified contacts, unchanged since, are sent whole
Scenario: AC-6 No push
  When a phone pushes a contact
  Then the line is forbidden `SYNC_TABLE_READ_ONLY` and nothing is stored
```

## Abuse cases
```gherkin
Scenario: AB-1 A pending contact reaches another business (information disclosure, T10)
  When any customer, supplier or particular customer pulls
  Then no pending or deleted contact of another business is in the answer
Scenario: AB-2 A business with no relationship (horizontal)
  When a person with no relationship to the business pulls
  Then none of its contacts is in the answer
```

## Implementation
- Create: `src/modules/sync/adapters/contacts.adapter.ts`, `tests/integration/sync/pull-contacts.test.ts`
- Modify: `src/modules/sync/sync.types.ts`, `src/modules/sync/sync.routes.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Signatures:
  - `registerContactAdapters(): void`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the organizations come from the viewer's ACTIVE memberships and from the relationships the predicate lets them see, never from the request.
- v5.0.0-15.3.1: the row is an explicit list; the author of a contact is not in it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| team | integration | AC-1 | three roles, three contacts |
| other side | integration | AC-2 | verified only |
| closed supplier | integration | AC-3 | still received |
| pending again | integration | AC-4, C-35 | updated and deleted |
| new relationship | integration | AC-5 | sent whole |
| no push | integration | AC-6 | forbidden |
| no pending leak | security | AB-1, CWE-200 | absent |
| no relationship | security | AB-2, CWE-639 | empty |

Command: `npx vitest run tests/integration/sync/pull-contacts.test.ts tests/integration/sync/registry-viewer.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/registry-viewer.test.ts | it expects 15 tables | it expects 16 tables, with organization_contacts last |

## Out of scope
- The driver's contacts of a client business: SYNC-042.
