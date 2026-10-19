---
id: ORG-021
title: Organization contacts table
module: organization
kind: migration
rev: 1
amends: [ORG-001]
size: M
risk: high
depends_on: [ORG-001, PER-003]
read_first: [prisma/schema.prisma, tests/integration/organization/organization-table.test.ts]
design_refs: [identite-et-organisation/organizationcontact, contraintes-a-poser-au-niveau-base-de]
constraints: [C-43, 'OrganizationContact:required', 'OrganizationContact.kind:enum', 'OrganizationContact.verification_method:enum', 'OrganizationContact:fk', C-35, C-01]
asvs: [v5.0.0-2.2.3]
---

# ORG-021 — Organization contacts table

## Story
Technical story: create the table of public contacts of a business, with the database rules that keep at most three numbers and one email.

## Context
- Exists: `organizations` (ORG-001), `people`, `set_server_updated_at()` (FND-002).
- Adds one migration, run in one transaction: table `organization_contacts` with `id`, `organization_id` (FK), `kind` (new type `OrganizationContactKind`), `slot` (integer, empty), `value`, `verified_at` (empty = pending), `verification_method` (new type `ContactVerificationMethod`, empty), `created_by_id` (FK to people), `created_at`, `server_updated_at`, `deleted_at`.
- CHECKs (C-43), besides the slot and verification rules: a PHONE `value` matches `^\+[1-9][0-9]{7,14}$`; an EMAIL `value` is lower case.
- The unique indexes (C-43) ignore deleted rows (C-35), so they are not written as `@@unique`. One number may belong to several organizations.
- `prisma/schema.prisma`: add `model OrganizationContact` and its enums, with above it a `//` comment in plain words: at most three numbers and one email per business, pending ones included; a deleted contact frees its place; one number may be public for several businesses; migration `org_021_organization_contacts`.
- `OrganizationContact` fields: `kind` enum [PHONE / EMAIL]; `slot` int, nullable; `value` string; `verified_at` datetime, nullable; `verification_method` enum [CODE / OWNER_PHONE], nullable; `created_by_id` FK → Person
- `C-43`: `OrganizationContact`: `slot` is set exactly when `kind = PHONE` and is between 1 and 3, unique per (`organization_id`, `slot`); at most one EMAIL per organization (partial unique index); unique per (`organization_id`, `value`); a PHONE `value` is in E.164 format; `verification_method` is set exactly when `verified_at` is set; all these uniqueness rules ignore deleted rows.
- `OrganizationContact:required`: NOT NULL: `organization_id`, `kind`, `value`, `created_by_id`, `created_at`
- `OrganizationContact.kind:enum`: one of PHONE, EMAIL
- `OrganizationContact.verification_method:enum`: one of CODE, OWNER_PHONE
- `OrganizationContact:fk`: references organization_id → Organization; created_by_id → Person
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Defaults
  When a PHONE contact with slot 1 is inserted
  Then `verified_at`, `verification_method` and `deleted_at` are empty and `server_updated_at` is set
Scenario Outline: AC-2 Row rules
  When a row is inserted with <values>
  Then the database <result>
  Examples:
    | values | result |
    | PHONE without slot | rejects (23514) |
    | EMAIL with a slot | rejects (23514) |
    | PHONE with slot 4 | rejects (23514) |
    | PHONE value without +237 | rejects (23514) |
    | EMAIL value Shop@Example.cm | rejects (23514) |
    | verified_at set without verification_method | rejects (23514) |
Scenario Outline: AC-3 Uniqueness among live rows
  Given an organization has a live contact PHONE slot 1 +237677000001
  When another row is inserted with <values>
  Then the database <result>
  Examples:
    | values | result |
    | same organization, slot 1, other number | rejects (23505) |
    | same organization, slot 2, same number | rejects (23505) |
    | other organization, slot 1, same number | accepts |
    | same organization, a second EMAIL | rejects (23505) |
Scenario: AC-4 A deleted contact frees its place
  Given the contact PHONE slot 1 is marked deleted
  When a new contact takes slot 1 with the same number
  Then the insert is accepted
```

## Abuse cases
```gherkin
Scenario: AB-1 A fourth number slips in (tampering)
  Given an organization holds the slots 1, 2 and 3
  When code inserts another PHONE contact, straight in the database
  Then PostgreSQL rejects it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_org_021_organization_contacts/migration.sql`, `tests/integration/organization/organization-contact-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the slot, kind and verification columns are checked in the database, not only in code.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| defaults | integration | AC-1, C-35 | insert → pending, live, server_updated_at set |
| row rules | integration | AC-2, C-43 | each Examples row → accepted or 23514 |
| uniqueness | integration | AC-3, C-43 | each Examples row → accepted or 23505 |
| deleted frees | integration | AC-4, C-35 | deleted then re-added → accepted |
| required, lists, keys | integration | OrganizationContact:required, OrganizationContact.kind:enum, OrganizationContact.verification_method:enum, OrganizationContact:fk | empty or unknown values → 23502, 22P02, 23503 |
| column types | integration | C-01 | uuid ids, timestamptz dates |
| slot overflow | security | AB-1, CWE-20 | a fourth number → rejected |

Command: `npx vitest run tests/integration/organization/organization-contact-table.test.ts`

## Out of scope
- Routes and services on contacts (ORG-024 to ORG-027); synchronization (SYNC).
