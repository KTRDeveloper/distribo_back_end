---
id: SYNC-019
title: First push after a rights change
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-018, SYNC-014]
read_first: [src/modules/sync/sync.judge.ts, src/modules/sync/sync.viewer.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne]
constraints: [CM-29, CM-03]
asvs: [v5.0.0-8.2.1, v5.0.0-16.3.1]
---

# SYNC-019 — First push after a rights change

## Story
As an owner, I want a demoted or revoked collaborator's late sales and collections to be kept, and their other operations refused and reported, so that no cash is left without a trace.

## Context
- Exists: judge pipeline, forbidden handling (SYNC-018), `Device.scope_version_seen` and `Person.scope_version`.
- Adds: when the pushing device's `scope_version_seen` is lower than the person's `scope_version` (the phone did not know about a rights change), the batch is judged with the current rights and: sales, order entry for delivered orders, deliveries and payments (operations a SELLER or DRIVER may make) are accepted even if the current role no longer allows them, and each is reported to the organization's OWNERs in one notification `sync.rights_changed` ("<n> opération(s) faites avec d'anciens droits"); every other operation the current rights do not allow is refused and reported to the OWNERs and the author.
- A person with no ACTIVE membership in the organization of a row is treated the same way for those operations only (a revoked collaborator's late sales pass), never for anything else. The device's `scope_version_seen` is not advanced by a push; only a full pull sets it (SYNC-008).
- `CM-29`: First send after a rights change (scope_version_seen older than scope_version): judged with current rights; seller operations (sales, deliveries, collections) are always accepted and reported to the owner, any other forbidden operation is refused and reported.
- `CM-03`: `Person.scope_version` is incremented by the server on every rights change.

## Acceptance criteria
```gherkin
Scenario: AC-1 Demoted manager's sales pass
  Given a manager demoted to seller while offline with 5 sales pushed after
  When the batch arrives
  Then the 5 sales are stored and the owner has one `sync.rights_changed`
Scenario: AC-2 Their manager powers are refused
  When the same batch has a credit note or a price change
  Then those lines are forbidden and the owner is told
Scenario: AC-3 Revoked collaborator
  When a revoked driver pushes 2 deliveries with collected payments made before they learned
  Then the deliveries and payments are stored and reported
Scenario: AC-4 Up-to-date phone
  When scope_version_seen equals scope_version
  Then the normal rules apply and no `sync.rights_changed` is sent
Scenario: AC-5 Nothing else opens
  When a revoked collaborator pushes a new customer, a cancellation or a note
  Then those lines are forbidden
```

## Abuse cases
```gherkin
Scenario: AB-1 Using the grace as a back door (elevation)
  When a revoked person pushes operations that are not sales, deliveries or payments
  Then they are all refused
```

## Implementation
- Create: `tests/integration/sync/rights-change.test.ts`
- Modify: `src/modules/sync/sync.judge.ts`, `src/modules/sync/sync.viewer.ts`, `src/modules/sync/sync.push.ts`
- Pattern: `src/modules/sync/sync.judge.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.1: only the three seller operations are honored under old rights.
- v5.0.0-16.3.1: every such batch is reported to the owners.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| demoted manager | integration | AC-1, CM-29 | sales stored, notice |
| powers refused | integration | AC-2, CM-03 | forbidden |
| revoked driver | integration | AC-3 | stored, reported |
| up to date | integration | AC-4 | no notice |
| nothing else | integration | AC-5 | forbidden |
| back door | security | AB-1, CWE-284 | refused |

Command: `npx vitest run tests/integration/sync/rights-change.test.ts`

## Out of scope
- The full resync after the push (SYNC-008, SYNC-018).
