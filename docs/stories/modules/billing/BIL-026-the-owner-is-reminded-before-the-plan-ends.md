---
id: BIL-026
title: The owner is reminded before the plan ends
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: medium
depends_on: [BIL-016, BIL-019, ORG-045]
read_first: [src/jobs/reconcile.ts, src/modules/billing/notices.ts]
design_refs: [finances/subscription]
constraints: []
asvs: [v5.0.0-2.3.3, v5.0.0-16.5.3]
---

# BIL-026 — The owner is reminded before the plan ends

## Story
Technical story: give billing a daily job that tells the owner 7 days, 1 day and 0 days before the plan ends, the first time with what will be paused.

## Context
- Exists: `readPlanFields`, `listOrganizationsEnding` (ORG-045); `readAfterEnd` (BIL-016); `findActiveOwnerId` (ORG-044); `notify`, `recipientLanguage` (NTF-002); `lockSubscriptions`, `insertEvent`, `runInTransaction` (BIL-011); `notices.ts` (BIL-019).
- `subscription.repository.ts` gains `hasReminder(tx, organizationId, planEndsAt, daysBefore)`: a REMINDER event with those details exists.
- `sendDueReminders(now)` in the new `reminder.service.ts` pages `listOrganizationsEnding` over the Douala calendar days of `now` to `now + 7` (UTC+1; pages of 500). Per business, in its own transaction under the lock, `days_before` is the number of Douala calendar days from `now` to `plan_ends_at`.
- Only 7, 1 and 0 send, once per `plan_ends_at`. That date ends the same-plan chain, so a follow-up of the same plan moves the reminder to the chain's end.
- A send inserts one REMINDER event (actor SYSTEM, details: `plan_ends_at`, `days_before`) and `notify({ recipientId, organizationId, sourceEvent: 'subscription.reminder', content }, tx)` for the active owner, in their language; no owner, no reminder. At 7 days the text adds the `readAfterEnd` counts above 0.
- A failing business is logged at `error` with its id, the loop goes on, the first error is rethrown after it. Job `src/jobs/send-reminders.ts`: `runSendRemindersJob(now)` logs the counts at `info`, returns 0; script `job:send-reminders`.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Which days
  Given an ESSENTIAL plan ending on 12 January 2027 (Douala day)
  When the job runs on <day>
  Then <result>
  Examples:
    | day                      | result                      |
    | 5 January                | one reminder, `days_before` 7 |
    | 11 January               | one reminder, `days_before` 1 |
    | 12 January               | one reminder, `days_before` 0 |
    | 8 January, or 13 (grace) | none                        |
Scenario: AC-2 Once per end date
  When the job runs twice on 5 January, the plan is extended to 12 April, and it runs on 5 April
  Then there is one reminder for 12 January and one for 12 April
Scenario Outline: AC-3 The text
  Given the plan ends on 12 January 2027, the owner reads <language>, <days> days before, and <pause>
  When the reminder is sent
  Then the notice `subscription.reminder` reads <text>
  Examples:
    | language | days | pause                        | text                                                                                                      |
    | FR       | 7    | 3 collaborators, 45 products | Votre forfait Essentiel se termine le 12 janvier 2027 : 3 collaborateurs et 45 produits seront mis en pause. |
    | EN       | 7    | nothing to pause             | Your Essential plan ends on January 12, 2027.                                                             |
    | FR       | 1    | 3 collaborators              | Votre forfait Essentiel se termine demain.                                                                |
    | EN       | 0    | 3 collaborators              | Your Essential plan ends today.                                                                           |
Scenario Outline: AC-4 A follow-up period
  Given <chain>
  When the job runs 7 days before the first period ends
  Then <result>
  Examples:
    | chain                           | result                       |
    | ESSENTIAL, then ESSENTIAL       | no reminder                  |
    | PRO, then ESSENTIAL scheduled   | one reminder for the PRO end |
Scenario: AC-5 Nobody to tell
  When the job runs 7 days before the end of a business without an active owner, and for a FREE business
  Then no event and no notice are written
Scenario: AC-6 A broken business
  Given the reminder of business B throws
  When the job runs
  Then the others get theirs, B's id is logged and the job rejects after the loop
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/modules/billing/reminder.service.ts`, `src/jobs/send-reminders.ts`, `tests/integration/billing/reminders.test.ts`
- Modify: `src/modules/billing/notices.ts`, `src/modules/billing/subscription.repository.ts`, `package.json`
- Pattern: `src/jobs/reconcile.ts`
- Signatures:
  - `sendDueReminders(now: Date): Promise<{ checked: number; sent: number }>`
  - `reminderNotice(language: 'FR' | 'EN', input: { daysBefore: 7 | 1 | 0; plan: PaidPlanCode; planEndsAt: Date; afterEnd: AfterEnd | null }): string`
  - `hasReminder(tx: Prisma.TransactionClient, organizationId: string, planEndsAt: Date, daysBefore: number): Promise<boolean>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: check, event and notice share one transaction under the business's lock: no double send.
- v5.0.0-16.5.3: a failing business is logged and skipped, the run fails at the end; nothing is swallowed.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| days | integration | AC-1 | each Examples row → reminder or none |
| once | integration | AC-2 | one per end date |
| text | integration | AC-3 | each Examples row → notice text |
| follow-up | integration | AC-4 | each Examples row → reminder or none |
| nobody | integration | AC-5 | no owner, FREE → nothing written |
| broken | integration | AC-6 | others sent, id logged, rejects |

Command: `npx vitest run tests/integration/billing/reminders.test.ts`

## Out of scope
- Choosing what to keep: BIL-018.
