# Execution report: auth

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-19 11:57 UTC: `/implement-stories ACC-008,AUTH-027..AUTH-038`

| story | status | commit | note |
|---|---|---|---|
| AUTH-027 Two new purposes for one-time codes | done | 96dea3d | OtpPurpose gains ORG_CONTACT_VERIFICATION and ACCESS_RESTORE; 3212 tests pass |
| AUTH-028 Sign-in tells the person what to do | blocked | 4bcaf56 | Code and story tests green; tests/integration/privacy/anonymize.test.ts AC-5 (not in Tests to update) expects 401 for an anonymized number, now 404 ACCOUNT_NOT_FOUND: may it be updated? |
| AUTH-030 Registration saves the interface language | done | b564eab | preferred_language optional FR/EN on register, stored for new and guest; tests green |
| AUTH-038 A verified email is unique whatever the letter case | done | 48840e3 | Characterization test for case-insensitive verified email uniqueness; 3 tests pass |

Not run: AUTH-029, AUTH-031..AUTH-034, AUTH-036, AUTH-035, AUTH-037.
Also in this run: access.

- Skipped, dependency not done: AUTH-029, AUTH-033, AUTH-036 (need AUTH-028, blocked); AUTH-031 (needs AUTH-029), AUTH-032 (needs AUTH-031), AUTH-034 (needs AUTH-033), AUTH-035 (needs AUTH-036), AUTH-037 (needs AUTH-031). All stay todo.
- Stash: "AUTH-028 blocked: partial changes".
- Run completed: every PLAN line reached; 4 done (ACC-008, AUTH-027, AUTH-030, AUTH-038), 1 blocked (AUTH-028), 8 skipped.
- AUTH-028 needs a decision: tests/integration/privacy/anonymize.test.ts AC-5 (not in its "Tests to update") expects 401 for an anonymized number, now 404 ACCOUNT_NOT_FOUND. PRIV-002 AC-5 says "generic 401" and would need the same wording.
- Baseline failing count: 0.
- Nothing unexpected: all report files found, figures filed, every hand-back matched STATUS.md.
- Next command: once AUTH-028's "Tests to update" is amended, `git stash pop` the AUTH-028 stash, then `/implement-stories AUTH-028,AUTH-029,AUTH-031..AUTH-037`.

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

- Filed: 2026-10-19 12:01 UTC
- Status: **done**: 404/401/403 answers, number-check quota; anonymize AC-5 test updated to 404
- Risk: high · story: [AUTH-028-sign-in-tells-the-person-what-to-do.md](../modules/auth/AUTH-028-sign-in-tells-the-person-what-to-do.md)
- Agent: 23,930 tokens, 8 tool uses, 1 min 25 s

### Agent report

**Summary:** Finished the earlier green implementation; updated the anonymize AC-5 test, now listed under Tests to update; done.

**Decisions:**
- Quota call sits in the number path of `requestLogin` (after normalization, before the lock counter); the email path is not counted (AUTH-036).
- The lock counter still rises on 404 cases (takeAttempt runs before the lookup); the story says the lock is unchanged.
- Dummy hash kept for the email path and `changePassword`; dropped only on the number path.
- Added log event `login_no_account` (no id, no number) for the 404 case.

**Tests added beyond the story:**
- `tests/integration/auth/login-answers.test.ts` › limit answer does not echo the number: 429 body carries no number (v5.0.0-16.3.1); passed at once
- `tests/integration/auth/login-answers.test.ts` › a limit hit queues nothing even for a registered number: quota runs first (story: "calls it first"); passed at once

**Evidence:** story tests 33/33 (login-answers, login-request, anonymize); full suite 3237/3237, failing: none, 0 known; typecheck clean; lint 0 errors, 137 warnings

**Follow-ups:**
- Code is uncommitted in the working tree.
<!-- end AUTH-028 -->

<!-- begin AUTH-029 -->
## AUTH-029 — A registered number gets no registration code

- Filed: 2026-10-19 12:03 UTC
- Status: **done**: registered holder: sent false, no challenge, no job; IP number-check quota counted
- Risk: high · story: [AUTH-029-a-registered-number-gets-no-registration-code.md](../modules/auth/AUTH-029-a-registered-number-gets-no-registration-code.md)
- Agent: 31,794 tokens, 12 tool uses, 1 min 40 s

### Agent report

**Summary:** register/request now answers sent false, expires_in 0 and the masked name for a registered holder (no challenge, no job) and counts each valid check in the IP quota.

**Decisions:**
- checkNumberQuota runs after number normalization, before the holder lookup (login pattern): invalid or foreign numbers stay refused before any limit is consumed, as the existing "pumping" test requires.
- Response schema `sent` widened from literal true to boolean (openapi text updated).

**Tests added beyond the story:**
- `register-request-no-code.test.ts` > a registered number is counted as a number check too: the quota also covers the no-code answer (AC-4, AUTH-028); written with the implementation, passed at once.

**Evidence:** story tests 16/16; full suite 3244/3244, failing: none, 0 known; typecheck clean; lint 0 errors, 137 warnings
<!-- end AUTH-029 -->

<!-- begin AUTH-030 -->
## AUTH-030 — Registration saves the interface language

- Filed: 2026-10-19 11:55 UTC
- Status: **done**: preferred_language optional FR/EN on register, stored for new and guest; tests green
- Risk: high · story: [AUTH-030-registration-saves-the-interface-language.md](../modules/auth/AUTH-030-registration-saves-the-interface-language.md)
- Agent: 28,041 tokens, 11 tool uses, 1 min 37 s

### Agent report

**Summary:** Register accepts optional `preferred_language` (FR/EN), stored for new and completed guest people.

**Decisions:**
- Absent field on a guest who already has a language: the language is left untouched (conditional spread), not reset to empty.
- `auth.openapi.ts` needed no edit: it reuses `registerSchema`; regenerated `openapi/openapi.json` instead.

**Tests added beyond the story:**
- `tests/integration/auth/register-language.test.ts` › a guest language is kept when the field is absent: no silent overwrite (AC-1 "column stays empty" only for new people; story silent on guests); passed at once? no, passes with the conditional write.
- Invalid-language and free-text cases passed at once (strict enum was already rejected by `.strict()`); kept as guards.

**Other additions:**
- `openapi/openapi.json` regenerated (7 lines).

**Evidence:** story tests 35/35 (language + register + register-new-holder); full suite 3223/3223, failing: none, 0 known; typecheck clean; lint 0 errors, 137 warnings
<!-- end AUTH-030 -->

<!-- begin AUTH-038 -->
## AUTH-038 — A verified email is unique whatever the letter case

- Filed: 2026-10-19 11:57 UTC
- Status: **done**: Characterization test for case-insensitive verified email uniqueness; 3 tests pass
- Risk: medium · story: [AUTH-038-a-verified-email-is-unique-whatever-the-letter.md](../modules/auth/AUTH-038-a-verified-email-is-unique-whatever-the-letter.md)
- Agent: 22,574 tokens, 8 tool uses, 1 min 16 s

### Agent report

**Summary:** Added the characterization test file; all 3 tests passed at once (no production code, as the story states).

**Decisions:**
- Phones +237677124466/67 in the new file: distinct from email-verify-confirm.test.ts so parallel files do not collide.

**Evidence:** story tests 10/10 (3 new + 7 existing); full suite 3226/3226, failing: none, 0 known; typecheck clean; lint 0 errors, 137 warnings (pre-existing)
<!-- end AUTH-038 -->
