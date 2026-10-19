---
id: ORG-035
title: The organization lets billing write the plan and pause seats
module: organization
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ORG-020, ORG-022, PER-005]
read_first: [src/modules/organization/organization.repository.ts, src/modules/person/person.repository.ts]
design_refs: [identite-et-organisation/organization, identite-et-organisation/collaboration]
constraints: [C-41, C-42, CM-03]
asvs: [v5.0.0-15.3.3, v5.0.0-8.2.1]
---

# ORG-035 — The organization lets billing write the plan and pause seats

## Story
Technical story: give billing the only server-side gates on the plan fields of a business and on the pause of its team seats.

## Context
- Exists: the plan columns with their database rule (ORG-020), `PAUSED` (ORG-022), `bumpScopeVersion` (PER-005). Billing calls these functions later; no route does.
- Adds to `organization.repository.ts`:
  - `writePlanFields(tx, organizationId, fields)`: writes `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators`, `max_products` and nothing else; after creation nothing else writes them. The database refuses an invalid combination; the error is thrown.
  - `listTeamSeats(tx, organizationId)`: non-owner, non-deleted ACTIVE, INVITED or PAUSED collaborations, oldest `invited_at` first, then `id`.
  - `setSeatPaused(tx, collaborationId, paused)`: `true` turns ACTIVE or INVITED into PAUSED; `false` turns PAUSED into ACTIVE, or INVITED when `accepted_at` is empty. Never the OWNER, a REVOKED or a deleted row. A change bumps the person's `scope_version` and returns true.
- Shipped before its caller; the tests call it directly.
- `C-41`: `Organization.payment_code` is unique; `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only; `plan = FREE` exactly when `plan_ends_at` is empty; a set `grace_ends_at` is after `plan_ends_at`.
- `C-42`: At each invitation, the ACTIVE or INVITED collaborators of an organization, owner excluded, number at most `Organization.max_collaborators`; the status PAUSED is written by the server only and never for the OWNER.
- `CM-03`: `scope_version` is incremented by the server on every rights change.

## Acceptance criteria
```gherkin
Scenario: AC-1 The plan fields are written alone
  When `writePlanFields` receives ESSENTIAL with an end date, no grace, 5 collaborators and no product limit
  Then those five columns hold the values and no other column changes
Scenario Outline: AC-2 The database refuses an impossible plan
  When `writePlanFields` receives <fields>
  Then it throws and the row is unchanged
  Examples:
    | fields                                          |
    | FREE with an end date                           |
    | PRO without an end date                         |
    | a grace end not after the plan end              |
Scenario: AC-3 The seat list
  Given an owner, ACTIVE, INVITED, PAUSED, REVOKED and deleted seats, and a seat of another business
  When `listTeamSeats` runs
  Then it returns the ACTIVE, INVITED and PAUSED ones, oldest invitation first
Scenario: AC-4 Pause
  When `setSeatPaused(true)` runs on an ACTIVE and on an INVITED seat
  Then both are PAUSED, each person's `scope_version` is +1 and the result is true
Scenario Outline: AC-5 Resume
  When `setSeatPaused(false)` runs on a PAUSED seat with <accepted>
  Then its status is <status> and `scope_version` is +1
  Examples:
    | accepted             | status  |
    | `accepted_at` set    | ACTIVE  |
    | `accepted_at` empty  | INVITED |
Scenario Outline: AC-6 Nothing to change
  When `setSeatPaused` runs on <row>
  Then the result is false and nothing changes
  Examples:
    | row                                   |
    | the OWNER, paused: true               |
    | a REVOKED or a deleted seat          |
    | an ACTIVE seat, paused: false         |
```

## Abuse cases
```gherkin
Scenario: AB-1 An owner picks a bigger plan (elevation)
  When the creation request carries `plan` or `max_collaborators`
  Then the answer is 400 VALIDATION_ERROR and no business is created
```

## Implementation
- Create: `tests/integration/organization/subscription-fields.test.ts`
- Modify: `src/modules/organization/organization.repository.ts`
- Pattern: `src/modules/person/person.repository.ts`
- Signatures:
  - `writePlanFields(tx: Prisma.TransactionClient, organizationId: string, fields: PlanFields): Promise<void>`
  - `listTeamSeats(tx: Prisma.TransactionClient, organizationId: string): Promise<TeamSeat[]>`
  - `setSeatPaused(tx: Prisma.TransactionClient, collaborationId: string, paused: boolean): Promise<boolean>`
- Types:
  - `PlanFields = { plan: 'FREE' | 'ESSENTIAL' | 'PRO' | 'ENTERPRISE'; planEndsAt: Date | null; graceEndsAt: Date | null; maxCollaborators: number | null; maxProducts: number | null }`
  - `TeamSeat = { id; personId; role; status: 'ACTIVE' | 'INVITED' | 'PAUSED'; invitedAt: Date; acceptedAt: Date | null }`
- Dependencies: none added

## Security
- v5.0.0-15.3.3: after creation the five plan columns have this one writer; no request field reaches them.
- v5.0.0-8.2.1: the seat query is bound to the organization given by server code.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| write alone | integration | AC-1, C-41 | five columns written, others unchanged |
| impossible plan | integration | AC-2, C-41 | each Examples row → throws |
| seat list | integration | AC-3 | rows and order |
| pause | integration | AC-4, C-42, CM-03 | PAUSED, bump, true |
| resume | integration | AC-5, C-42, CM-03 | each Examples row → status, bump |
| no change | integration | AC-6, C-42 | each Examples row → false |
| plan in the body | security | AB-1, CWE-915 | 400, no row |

Command: `npx vitest run tests/integration/organization/subscription-fields.test.ts`

## Out of scope
- Computing the plan, choosing who is paused, telling people: billing.
