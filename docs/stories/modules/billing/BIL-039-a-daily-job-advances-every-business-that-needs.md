---
id: BIL-039
title: A daily job advances every business that needs it
module: billing
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [BIL-028, ORG-045]
read_first: [src/jobs/reconcile.ts, src/modules/billing/advance.service.ts]
design_refs: [finances/subscription]
constraints: [C-52]
asvs: [v5.0.0-2.3.3, v5.0.0-16.5.3]
---

# BIL-039 — A daily job advances every business that needs it

## Story
Technical story: give billing a job that refreshes the periods, rights and paused items of each business whose dates passed, so that a plan ends on time even if nobody opens the app.

## Context
- Exists: `advanceSubscription` (BIL-028), `listOrganizationsToRefresh` (ORG-045), `runInTransaction` (BIL-011); `src/jobs/reconcile.ts` is the model of a job.
- `subscription.repository.ts` gains `listBusinessesToAdvance(now, limit, afterId?)`: ids, ascending, of businesses with an ACTIVE period whose `ends_at <= now` or a SCHEDULED one whose `starts_at <= now`.
- `advanceDueBusinesses(now)` in the new `expire.service.ts` reads both lists page by page (`ADVANCE_PAGE` 500), takes their union once per id, ascending, and runs `advanceSubscription` for each in its own transaction. It returns `{ checked, ended, started, planChanged }`.
- A business that fails is logged at `error` with its id and the loop goes on; the first error is rethrown after the loop, so `main` exits 2.
- Job `src/jobs/expire-forfaits.ts`: `runExpireForfaitsJob(now)` logs the report at `info` (counts only) and returns 0; script `job:expire-forfaits`. The schedule is outside the job (Q-010).
- `C-52`: `Subscription` allows at most one ACTIVE row per organization (partial unique index); periods of one organization never overlap (exclusion constraint); `starts_at` is not after `ends_at`; `payment_id` and `months` are set exactly when `origin = PAYMENT`; `end_reason` is set exactly when `status = ENDED`; only the server writes it.

## Acceptance criteria
```gherkin
Scenario: AC-1 Only the businesses that need it
  Given A with a lapsed ACTIVE period, B with a running one, C with a SCHEDULED period whose time came, and D FREE
  When the job runs
  Then A and C are advanced, B and D are not touched, and the report says `checked` 2
Scenario: AC-2 Grace over and excess seats
  Given E whose last period ended 8 days ago with plan columns still ESSENTIAL, and F with limit 2 and 3 ACTIVE seats
  When the job runs
  Then E is FREE and one seat of F is paused
Scenario: AC-3 Once per business
  Given a business that both lists return
  When the job runs
  Then it is advanced once: one FORFAIT_ENDED event
Scenario: AC-4 A second run
  When the job runs twice with the same `now`
  Then the second run changes no row and writes no event
Scenario: AC-5 More than a page
  Given 3 businesses to advance and `ADVANCE_PAGE` set to 2 in the test
  When the job runs
  Then all 3 are advanced
```

## Abuse cases
```gherkin
Scenario: AB-1 One broken business blocks the others (denial of service)
  Given the advance of business B throws
  When the job runs
  Then the other businesses are still advanced, the error is logged with B's id only, and the job rejects after the loop
```

## Implementation
- Create: `src/modules/billing/expire.service.ts`, `src/jobs/expire-forfaits.ts`, `tests/integration/billing/expire-forfaits.test.ts`
- Modify: `src/modules/billing/subscription.repository.ts`, `package.json`
- Pattern: `src/jobs/reconcile.ts`
- Signatures:
  - `advanceDueBusinesses(now: Date): Promise<AdvanceReport>`
  - `runExpireForfaitsJob(now?: Date): Promise<number>`
  - `listBusinessesToAdvance(now: Date, limit: number, afterId?: string): Promise<string[]>`
- Types:
  - `AdvanceReport = { checked: number; ended: number; started: number; planChanged: number }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: each business is advanced in its own transaction, so a failure leaves no half-done business.
- v5.0.0-16.5.3: a failing business is logged and skipped, and the run still fails at the end; nothing is swallowed.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| selection | integration | AC-1, C-52 | A and C advanced, B and D untouched |
| grace and seats | integration | AC-2 | E FREE, one seat paused |
| once | integration | AC-3 | one event for a business in both lists |
| second run | integration | AC-4 | no change |
| pages | integration | AC-5 | 3 advanced with a page of 2 |
| broken business | security | AB-1, CWE-400 | others advanced, id logged, job rejects |

Command: `npx vitest run tests/integration/billing/expire-forfaits.test.ts`

## Out of scope
- Reminders before the end: BIL-026. Closing or reopening a business: BIL-031.
