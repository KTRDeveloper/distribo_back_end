# Execution report: auth

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

<!-- begin AUTH-027 -->
## AUTH-027 — Two new purposes for one-time codes

- Filed: 2026-10-19 11:51 UTC
- Status: **done**: OtpPurpose gains ORG_CONTACT_VERIFICATION and ACCESS_RESTORE; 3212 tests pass
- Risk: high · story: [AUTH-027-two-new-purposes-for-one-time-codes.md](../modules/auth/AUTH-027-two-new-purposes-for-one-time-codes.md)
- Agent: 22,216 tokens, 12 tool uses, 1 min 25 s

### Agent report

**Summary:** Added the two OtpPurpose values (migration + Prisma enum) and the story's three tests.

**Decisions:**
- Migration uses `ADD VALUE IF NOT EXISTS`: matches the AUTH-001 migration style, safe to rerun.
- Left the hand-written `OtpPurpose` union in `src/modules/auth/otp.repository.ts` at six values: nothing issues the new codes yet (story out of scope).

**Evidence:** story tests 9/9 (with otp-table); full suite 3212/3212, failing: none, 0 known; typecheck clean; lint 0 errors, 137 warnings
<!-- end AUTH-027 -->

<!-- begin AUTH-028 -->
## AUTH-028 — Sign-in tells the person what to do

- Filed: 2026-10-19 11:53 UTC
- Status: **blocked**: Code and story tests green; tests/integration/privacy/anonymize.test.ts AC-5 (not in Tests to update) expects 401 for an anonymized number, now 404 ACCOUNT_NOT_FOUND: may it be updated?
- Risk: high · story: [AUTH-028-sign-in-tells-the-person-what-to-do.md](../modules/auth/AUTH-028-sign-in-tells-the-person-what-to-do.md)
- Agent: 50,251 tokens, 14 tool uses, 2 min 22 s

### Agent report

**Summary:** Blocked: implemented and green, but one existing test outside "Tests to update" now fails and I may not edit it.

**Decisions:**
- Quota call placed in the number path of `requestLogin` (after phone normalization, before the lock counter); the email path does not count as a number check (AUTH-036 owns it).
- The lock counter still rises on 404 cases (takeAttempt runs before the lookup); the story says the lock is unchanged.
- Dummy hash kept for the email path and `changePassword`; dropped only on the number path.
- Added log event `login_no_account` (no id, no number) for the 404 case.

**Tests added beyond the story:**
- `tests/integration/auth/login-answers.test.ts` › limit answer does not echo the number: 429 body carries no number (v5.0.0-16.3.1); passed at once
- `tests/integration/auth/login-answers.test.ts` › a limit hit queues nothing even for a registered number: quota runs before any code is queued (story: "calls it first"); passed at once

**Other additions:**
- None beyond the story's files (`login-request.test.ts` updated as listed).

**Evidence:** story tests 20/20 (login-answers + login-request); full suite 3222/3223, failing: tests/integration/privacy/anonymize.test.ts AC-5, 0 known; typecheck clean; lint 0 errors, 137 warnings (pre-existing style)

**Follow-ups:**
- QUESTION: `tests/integration/privacy/anonymize.test.ts` › "AC-5: login with the old number and password answers the generic 401" expects 401 INVALID_CREDENTIALS; an anonymized number is now an unknown number, so it answers 404 ACCOUNT_NOT_FOUND (PRIV-002 AC-5 says "generic 401"). Needs the test (and PRIV-002 AC-5 wording) updated to 404; AUTH-028's "Tests to update" does not list it. Code is left uncommitted in the working tree.
<!-- end AUTH-028 -->
