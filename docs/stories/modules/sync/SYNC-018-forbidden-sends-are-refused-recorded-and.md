---
id: SYNC-018
title: Forbidden sends are refused, recorded and trigger a resync
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-010, NTF-002]
read_first: [src/modules/sync/sync.judge.ts, src/modules/sync/sync.push.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne]
constraints: [CM-28, C-36]
asvs: [v5.0.0-8.2.1, v5.0.0-16.3.2, v5.0.0-16.3.3]
---

# SYNC-018 — Forbidden sends are refused, recorded and trigger a resync

## Story
As a seller, I want to be told when the server did not record something I did so that my phone shows the truth.

## Context
- Exists: `forbidden` outcomes (SYNC-010), the envelope (SYNC-009).
- Adds: handling of every `forbidden` outcome and every `aside` line at the end of `judgeBatch`: each is logged at `warn` with event `sync_line_refused` (table, row id, code, person id; no row content); the response's `rejected` lists it; `resync_required` is true so the phone erases and pulls again; the author gets one notification `sync.refused` per batch: "<n> opération(s) non enregistrée(s). Motif : <code>" (French or English by language), naming for each of the first 5 lines a label built from the table and a short code, never amounts or names.
- A line no rule knows how to write is set aside (`aside` count, the rest of the batch passes); an administrator can replay the batch later (SYNC-022).
- `CM-28`: Sync outcomes: a business problem is stored with sync_issue; a conflict is refused until the phone pulls and resends; a forbidden send is refused, recorded, and triggers a full resync plus a notification to its author; a line no rule can write is set aside while the rest passes.
- `C-36`: No uniqueness rule makes a sync fail; every possible duplicate has a written behavior, and a line no rule can write is set aside.

## Acceptance criteria
```gherkin
Scenario: AC-1 Refusal is reported
  When a batch holds one forbidden line and two good lines
  Then the two good lines are stored, `rejected` has one item and resync_required is true
Scenario: AC-2 Author notified
  Then the author has one unread `sync.refused` mentioning 1 refused operation
Scenario: AC-3 Set aside
  When a line no adapter can write is in the batch
  Then it is counted in `aside`, the author is notified, and the batch is otherwise applied
Scenario: AC-4 Logging without content
  Then the `warn` log has table, id, code and person id and no field values
Scenario: AC-5 Clean batch
  Then rejected is empty and resync_required is false
```

## Abuse cases
```gherkin
Scenario: AB-1 Probing the rules through refusals (information disclosure)
  When a phone sends many forbidden lines
  Then the codes reveal only OUT_OF_SCOPE, FIELD_NOT_ALLOWED or ONLINE_ONLY and never other data
```

## Implementation
- Create: `tests/integration/sync/forbidden-sends.test.ts`
- Modify: `src/modules/sync/sync.judge.ts`, `src/modules/sync/sync.push.ts`
- Pattern: `src/modules/sync/sync.judge.ts`
- Dependencies: `pino`, `@prisma/client`

## Security
- v5.0.0-16.3.2: refused authorization attempts are logged.
- v5.0.0-8.2.1: a refused line changes nothing.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| refusal reported | integration | AC-1, CM-28 | rejected and resync |
| author notified | integration | AC-2 | notification |
| set aside | integration | AC-3, C-36 | counted |
| log without content | integration | AC-4 | no values |
| clean | integration | AC-5 | empty |
| probing | security | AB-1, CWE-200 | codes only |

Command: `npx vitest run tests/integration/sync/forbidden-sends.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/push-payments.test.ts › "forbids a phone creating or deleting a notification" | counts every notification, so the author's new `sync.refused` notice makes 3 instead of 2 | `rejected` still has 2 lines; the notifications other than `sync.refused` (`sourceEvent` not `sync.refused`) still number 2, so the phone neither created nor deleted one |

## Out of scope
- Rights changes (SYNC-019).
