---
id: BIL-019
title: Collaborators beyond the plan are paused and come back when it allows
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-018, BIL-011, ORG-035, ORG-044, DLV-015, NTF-002]
read_first: [src/modules/billing/subscription.repository.ts]
design_refs: [finances/subscription]
constraints: [C-42]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# BIL-019 — Collaborators beyond the plan are paused and come back when it allows

## Story
Technical story: give billing the function that pauses the collaborators a plan no longer covers and brings them back when a plan allows, following the owner's choice, so that the team always fits the plan.

## Context
- Exists: `listTeamSeats` and `setSeatPaused` (ORG-035), `findDriversWithOpenDeliveries` (DLV-015), `notify` and `recipientLanguage` (NTF-002), `findOrganizationSummary` (ORG-044), `insertEvent` (BIL-011), the KEEP_CHOICE events (BIL-018).
- `findLatestKeepChoice(tx, organizationId)` is added to `subscription.repository.ts`: the details of the latest KEEP_CHOICE event, or null.
- New `seat-limit.service.ts`: `enforceSeatLimit(tx, organizationId, maxCollaborators, now)`, `null` meaning no limit. It ranks every seat of `listTeamSeats`, whatever its status: first the ids of the latest choice, in the order given; then accepted seats (`acceptedAt` set) oldest first; then pending invitations oldest first. The first `maxCollaborators` stay or return; the rest are paused.
- A seat to pause that is a DRIVER with an open delivery is left as it is and listed as deferred; the next run pauses it. The OWNER is never in the list.
- Each change is made with `setSeatPaused`, logs one PAUSED or RESUMED event (actor SYSTEM, details: the collaboration id) and notifies the person: `subscription.paused` or `subscription.resumed`, in their language, from `notices.ts` (new, French and English texts that name the business and hold no other personal data).
- `C-42`: At each invitation, the ACTIVE or INVITED collaborators of an organization, owner excluded, number at most `Organization.max_collaborators`; the status PAUSED is written by the server only and never for the OWNER.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Who stays
  Given a limit of 2 and no choice
  When the seats are <seats>
  Then <paused> are paused
  Examples:
    | seats (oldest first)                       | paused |
    | A accepted, B accepted, C accepted         | C      |
    | A accepted, B pending, C accepted          | B      |
    | A accepted, B pending, C pending           | C      |
Scenario: AC-2 The owner's choice
  Given a limit of 2, seats A, B, C all accepted, and a choice naming C
  When the limit is enforced
  Then C and A stay and B is paused
Scenario: AC-3 They come back
  Given B paused after being accepted and C paused while still pending, and a limit of 5
  When the limit is enforced
  Then B is ACTIVE again and C is INVITED again
Scenario: AC-4 A driver on the road
  Given the seat to pause is a driver with an open delivery
  When the limit is enforced, then the delivery closes and it is enforced again
  Then the first run lists the seat as deferred and changes nothing, and the second pauses it
Scenario: AC-5 No limit and no owner
  When `maxCollaborators` is null
  Then every paused seat returns, and the owner's seat is never read or changed
Scenario: AC-6 Journal and notices
  When a seat is paused and another resumed
  Then there is one PAUSED and one RESUMED event and one notice each in the person's language, and a second run changes and writes nothing
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's team is touched (broken access control)
  Given business B has seats over its limit
  When the limit is enforced for business A
  Then no seat of B changes
```

## Implementation
- Create: `src/modules/billing/seat-limit.service.ts`, `src/modules/billing/notices.ts`, `tests/integration/billing/seat-limit.test.ts`
- Modify: `src/modules/billing/subscription.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `enforceSeatLimit(tx: Prisma.TransactionClient, organizationId: string, maxCollaborators: number | null, now: Date): Promise<SeatEnforcement>`
  - `findLatestKeepChoice(tx: Prisma.TransactionClient, organizationId: string): Promise<{ collaborationIds: string[]; productIds: string[] } | null>`
  - `seatNotice(kind: 'PAUSED' | 'RESUMED', language: 'FR' | 'EN', businessName: string): string`
- Types:
  - `SeatEnforcement = { paused: string[]; resumed: string[]; deferred: string[] }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: every read and write is bound to the organization id given by server code.
- v5.0.0-2.3.3: seats, events and notices belong to the caller's transaction.
- v5.0.0-16.3.1: events and logs carry ids only; a notice names the business, never another person.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| who stays | integration | AC-1, C-42 | each Examples row → paused seats |
| choice | integration | AC-2 | C kept before A |
| return | integration | AC-3 | ACTIVE and INVITED |
| driver | integration | AC-4 | deferred then paused |
| no limit | integration | AC-5 | all back, owner unchanged |
| journal | integration | AC-6 | events, notices, no change on a repeat |
| other business | security | AB-1, CWE-639 | B's seats unchanged |

Command: `npx vitest run tests/integration/billing/seat-limit.test.ts`

## Out of scope
- Computing the limit and calling this function: BIL-014, BIL-028.
- Products: BIL-020.
