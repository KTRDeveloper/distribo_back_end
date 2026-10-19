---
id: SYNC-039
title: A paused collaborator gets the grace of a revoked one
module: sync
kind: change
rev: 1
amends: [SYNC-019]
size: S
risk: high
depends_on: [SYNC-019, BIL-019]
read_first: [src/modules/sync/sync.repository.ts, tests/integration/sync/rights-change.test.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, identite-et-organisation/collaboration]
constraints: [CM-29]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2]
---

# SYNC-039 — A paused collaborator gets the grace of a revoked one

## Story
As an owner, I want the late sales and collections of a collaborator whose seat was paused to be kept and reported, so that no cash is left without a trace.

## Context
- Exists: the grace of a stale device (SYNC-019): `findRightsHistory` returns the REVOKED memberships as `formerMemberships`, and the judge lends the grace role to a person who no longer belongs to the organization. `setSeatPaused` writes `Collaboration.status = PAUSED` and moves `Person.scope_version` (BIL-019). `findViewerData` keeps ACTIVE memberships only, so a paused collaborator already pulls and pushes nothing of the business.
- Change in `sync.repository.ts`: `findRightsHistory` returns the memberships whose status is REVOKED or PAUSED (not deleted), with their role. The comments that say REVOKED in `sync.viewer.ts` and `sync.types.ts` say "REVOKED or PAUSED".
- Nothing else changes: sales, deliveries and payments made before the phone learned of the pause are kept and reported to the owners in one `sync.rights_changed`; every other line is refused.
- A phone that knows the current version gets no grace. A resumed seat (ACTIVE again) is judged by its role.
- `CM-29`: First send after a rights change (scope_version_seen older than scope_version): judged with current rights; seller operations (sales, deliveries, collections) are always accepted and reported to the owner, any other forbidden operation is refused and reported (design lines 883-887)

## Acceptance criteria
```gherkin
Scenario: AC-1 Late sales of a paused seller
  Given a seller whose seat was paused while their phone was offline, with 2 sales made before
  When the batch arrives
  Then the 2 sales are stored and the owner has one `sync.rights_changed`
Scenario: AC-2 Nothing else opens
  When the same batch has a new customer, a cancellation and a note
  Then those lines are forbidden
Scenario: AC-3 A phone that knows
  Given the phone's scope version equals the person's
  When the paused seller pushes a sale
  Then the line is refused as out of scope and no notification is sent
Scenario: AC-4 Nothing is pulled
  When the paused collaborator makes a full pull
  Then no row of the business is in the answer
Scenario: AC-5 Resumed
  Given the seat is ACTIVE again
  When the collaborator makes a full pull and then pushes a sale
  Then the business rows are in the answer and the sale is judged by their role
```

## Abuse cases
```gherkin
Scenario: AB-1 Using the pause as a back door (elevation)
  When a paused manager pushes a credit note, a price change, and a sale for a business they never belonged to
  Then all three are refused
```

## Implementation
- Create: `tests/integration/sync/rights-paused.test.ts`
- Modify: `src/modules/sync/sync.repository.ts`, `src/modules/sync/sync.viewer.ts`, `src/modules/sync/sync.types.ts`
- Pattern: `src/modules/sync/sync.viewer.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.1: the grace covers sales, deliveries and payments only; the judge's other checks run as for a revoked collaborator.
- v5.0.0-8.2.2: the memberships come from the database by the session's person, never from the request.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| late sales | integration | AC-1, CM-29 | 2 sales stored, one notice |
| refused lines | integration | AC-2 | forbidden |
| phone that knows | integration | AC-3 | out of scope, no notice |
| pull | integration | AC-4 | no row of the business |
| resumed | integration | AC-5 | rows back, role applies |
| back door | security | AB-1, CWE-284 | all refused |

Command: `npx vitest run tests/integration/sync/rights-paused.test.ts tests/integration/sync/rights-change.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/rights-change.test.ts | seeds REVOKED and ACTIVE memberships; none is PAUSED | unchanged |

## Out of scope
- Pausing and resuming seats: BIL-019.
