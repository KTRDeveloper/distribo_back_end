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

<!-- begin AUTH-031 -->
## AUTH-031 — A recycled number can be claimed after six idle months

- Filed: 2026-10-19 12:06 UTC
- Status: **done**: claim route, claimRefusal, latestDeviceActivity; 19 tests; suite green
- Risk: high · story: [AUTH-031-a-recycled-number-can-be-claimed-after-six-idle.md](../modules/auth/AUTH-031-a-recycled-number-can-be-claimed-after-six-idle.md)
- Agent: 51,159 tokens, 17 tool uses, 2 min 49 s

### Agent report

**Summary:** Added POST /api/v1/auth/register/claim, claimRefusal, latestDeviceActivity; all tests green.

**Decisions:**
- Six months back clamps to month end (31 Aug gives 28 Feb), never rolls into the next month: the story says "same date" without covering short months.
- Activity exactly at the limit counts as idle (strictly later = RECENTLY_ACTIVE); story is silent on equality, untested at that instant.
- Number validated before checkNumberQuota, as in requestRegistrationCode (AUTH-029); logic duplicated, not shared, to leave auth.service.ts untouched.
- A guest holder (registered_at null) is treated like no holder: code sent with personId null.

**Tests added beyond the story:**
- `number-claim.test.ts` › holder with no device is idle (story Context); passed at once with the implementation.
- › latest activity over all devices counts (Context: revoked devices included)
- › refused claim still counts as a number check (Context: checkNumberQuota first)
- › guest holder treated as no registered holder (Context)
- › foreign/malformed number and unknown fields rejected (Errors, CONVENTIONS strict schemas)
- › refusal logged with holder id and reason, never the number (Security 16.3.1)
- › claimRefusal boundary (ms precision, short month) and suspension precedence (Context)

**Other additions:**
- registerClaimSchema / registerClaimResponseSchema in auth.schemas.ts; route added to catalog.test.ts and per-001.test.ts lists; openapi/openapi.json regenerated.

**Evidence:** story tests 19/19; full suite 3263/3263, failing: none, 0 known; typecheck clean; lint 0 errors, 137 warnings

**Follow-ups:**
- contracts.md does not list claimRefusal yet (stories folder off-limits to me).
<!-- end AUTH-031 -->

<!-- begin AUTH-032 -->
## AUTH-032 — Registering on a recycled number re-checks the old holder

- Filed: 2026-10-19 12:07 UTC
- Status: **blocked**: register-new-holder.test.ts seedHolder creates a device (created_at now) so claimRefusal answers 409 on 5 of its tests; story says its holders have no device. Fix the fixture (list it as changed) or decide that a never-synced device is idle?
- Risk: high · story: [AUTH-032-registering-on-a-recycled-number-re-checks-the.md](../modules/auth/AUTH-032-registering-on-a-recycled-number-re-checks-the.md)

### Agent report

**Summary:** Blocked: the story says register-new-holder.test.ts holders have no device, but its seedHolder creates a device (created_at = now), so the new re-check refuses 5 of its 7 tests with 409.

**Decisions:**
- Added `spend: false` option to `verifyCode` plus `spendCode` in otp.service.ts (not listed): the code must be checked, then the holder re-checked, then the code spent, so a refusal leaves it unspent.

**Tests added beyond the story:**
- `tests/integration/auth/register-recycled-recheck.test.ts` › wrong code answers OTP_INVALID, not holder state: no leak of holder activity (CONVENTIONS fail closed); passed at once
- same file › without new_holder ACCOUNT_EXISTS still: AC "Without new_holder" in Context; passed at once

**Evidence:** story's new test file 9/9 pass; register-new-holder.test.ts 2/7 pass (5 fail with 409); full suite not run; typecheck/lint not run.

**Follow-ups:**
- Question: latestDeviceActivity uses COALESCE(last_synced_at, created_at), so a device created now counts as activity. Either list register-new-holder.test.ts under "Tests to update" and backdate its device (or drop it), or state that a never-synced device is idle (changes AUTH-031 rule).
- Code changes (auth.service.ts, otp.service.ts, new test) are left in the working tree for the orchestrator to set aside.
<!-- end AUTH-032 -->

<!-- begin AUTH-033 -->
## AUTH-033 — The reset code comes by SMS only

- Filed: 2026-10-19 12:10 UTC
- Status: **done**: Reset code by SMS only; use_email now 400; number quota counted first
- Risk: high · story: [AUTH-033-the-reset-code-comes-by-sms-only.md](../modules/auth/AUTH-033-the-reset-code-comes-by-sms-only.md)
- Agent: 33,456 tokens, 14 tool uses, 1 min 58 s

### Agent report

**Summary:** Password reset request now sends the code by SMS only; `use_email` is refused with 400 and `checkNumberQuota` runs first.

**Decisions:**
- Quota placement: `checkNumberQuota` runs before number normalization, so malformed numbers are counted too (story: "runs first").
- `use_email` removal: dropped from the strict schema, so the 400 comes from the existing schema validation (also for `use_email: false`).

**Tests added beyond the story:**
- `tests/integration/auth/password-reset-sms-only.test.ts` › a malformed number is counted too: scans cannot dodge the IP limit (Context: quota runs first); failed before the change
- same file › email refused also for `use_email: false` (strict schema, AC-2); failed before the change

**Other additions:**
- Updated the 'email' and 'unverified email' cases in `password-reset-request.test.ts` as listed under Tests to update; 429 description in `auth.openapi.ts` now mentions RATE_LIMITED.

**Evidence:** story tests 16/16; full suite 3270/3270, failing: none, 0 known; typecheck clean; lint 0 errors, 137 warnings

**Follow-ups:**
- `confirmPasswordReset` still accepts `use_email` (AUTH-034 scope), so an EMAIL code can no longer be issued for reset but the confirm schema still allows the flag.
<!-- end AUTH-033 -->

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
