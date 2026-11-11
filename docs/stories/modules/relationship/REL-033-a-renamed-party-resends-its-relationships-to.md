---
id: REL-033
title: A renamed party resends its relationships to phones
module: relationship
kind: migration
rev: 1
amends: []
size: S
risk: high
depends_on: [SYNC-047]
read_first: [prisma/schema.prisma, tests/integration/organization/amount-held.test.ts]
design_refs: [a5-nom-public-du-client-chez-le, a6-nom-public-du-fournisseur-chez-le]
constraints: []
asvs: [v5.0.0-15.3.1]
---

# REL-033 — A renamed party resends its relationships to phones

## Story
Technical story: mark a relationship changed when a party's name changes, so that phones pull the new public name.

## Context
- The public names (SYNC-047) are computed at each pull from `persons.full_name` and `organizations.name`; a phone pulls a relationship again only when its `server_updated_at` moves, which the database sets on every change of the row.
- Trigger after update of `persons.full_name` (rename, anonymization), when the value changes: touch every `customer_relationships` row whose `customer_person_id` or `supplier_person_id` is that person.
- Trigger after update of `organizations.name`, when the value changes: touch every row whose `customer_organization_id` or `supplier_organization_id` is that organization.
- The migration also touches every existing row once, so phones receive the new fields.
- Add both triggers to the `//` comment above `CustomerRelationship` in `schema.prisma`, in plain words, with this migration's name.

## Acceptance criteria
```gherkin
Scenario: AC-1 A person's new name
  Given a relationship whose customer is person P
  When P's full_name changes
  Then the relationship's server_updated_at moves forward
Scenario: AC-2 An organization's new name
  Given a relationship whose supplier is organization S
  When S's name changes
  Then the relationship's server_updated_at moves forward
Scenario: AC-3 Nothing changes, nothing moves
  When P's phone or S's city changes, or a name is set to the same value
  Then server_updated_at stays the same
Scenario: AC-4 Put into service
  Then after the migration every relationship has a server_updated_at later than before it
```

## Abuse cases
```gherkin
Scenario: AB-1 Another party's rows
  Given person Q in no relationship with S
  When Q's full_name changes
  Then no relationship of S moves
```

## Implementation
- Create: `prisma/migrations/<timestamp>_rel_033_public_name_touch/migration.sql`, `tests/integration/relationship/public-name-touch.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-15.3.1: an anonymized name reaches phones at their next pull instead of staying on them.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| person rename | integration | AC-1 | server_updated_at later |
| organization rename | integration | AC-2 | server_updated_at later |
| no name change | integration | AC-3 | server_updated_at unchanged |
| put into service | integration | AC-4 | every row touched by the migration |
| other party | security | AB-1, CWE-639 | S's rows unchanged |

Command: `npx vitest run tests/integration/relationship/public-name-touch.test.ts`

## Out of scope
- Computing the public names (SYNC-047).
