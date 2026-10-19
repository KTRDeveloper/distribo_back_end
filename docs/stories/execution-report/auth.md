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

- Filed: 2026-10-19 12:16 UTC
- Status: **done**: re-check before spending the code, firePhoneReleased in tx; register-new-holder fixture backdated
- Risk: high · story: [AUTH-032-registering-on-a-recycled-number-re-checks-the.md](../modules/auth/AUTH-032-registering-on-a-recycled-number-re-checks-the.md)
- Agent: 25,880 tokens, 8 tool uses, 1 min 15 s

### Agent report

**Summary:** Registration with new_holder now re-checks the old holder (claimRefusal) before the code is spent and fires firePhoneReleased in the same transaction.

**Decisions:**
- `verifyCode(..., { spend: false })` plus `spendCode` in otp.service.ts (not listed): the code must be checked, the holder re-checked, then the code spent, so a refusal leaves it unspent.
- Refusal logged as `registration_refused_number_in_use` with holder id and reason (v5.0.0-16.3.1).

**Tests added beyond the story:**
- `tests/integration/auth/register-recycled-recheck.test.ts` › wrong code answers OTP_INVALID, not holder state: no leak of holder activity (fail closed); passed at once
- same file › without new_holder ACCOUNT_EXISTS still: Context of the story; passed at once

**Other additions:**
- `register-new-holder.test.ts` seedHolder device backdated 400 days, as listed under Tests to update.

**Evidence:** story tests 17/17 (both files); full suite 3287/3287, failing: none, 0 known; typecheck clean; lint 0 errors, 137 warnings

**Follow-ups:**
- None.
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

<!-- begin AUTH-034 -->
## AUTH-034 — The new password opens the session on this phone

- Filed: 2026-10-19 12:13 UTC
- Status: **done**: Reset confirm returns 200 session; suspended refused after code; all tests pass
- Risk: high · story: [AUTH-034-the-new-password-opens-the-session-on-this-phone.md](../modules/auth/AUTH-034-the-new-password-opens-the-session-on-this-phone.md)
- Agent: 55,559 tokens, 18 tool uses, 2 min 52 s

### Agent report

**Summary:** confirmPasswordReset now returns a SessionResponse (200): hash, revocation and new device in one transaction; suspended refused with 403 only after the code is spent.

**Decisions:**
- Order: weak password, then holder lookup, then verifyCode, then suspended check; so a wrong code on a suspended account is OTP_INVALID (AB-2) and a weak password or bad device keeps the code.
- `use_email` removed from the strict schema and the service type, so it fails as VALIDATION_ERROR.
- Added a `warn` event `password_reset_refused_suspended` (person id only), like the login one.

**Tests added beyond the story:**
- `password-reset-session.test.ts` › invalid device keeps the code and the password: bad device info refused before the code is spent (schema validation before any DB call)
- `password-reset-session.test.ts` › lock cleared and the reset logged with ids only: failure counter cleared, log carries person and device ids, no password or code (story text, v5.0.0-16.3.1)

**Other additions:**
- confirm test: replaced 204 by 200 and added `device` (listed in Tests to update); it had no email cases to change.
- openapi/openapi.json regenerated by the suite.

**Evidence:** story tests 16/16 (plus quality-gates rerun 13/13 after a lint fix); full suite 3277/3278 on first run, the one failure (quality-gates lint) was my 4 test lint errors, fixed and rerun green; typecheck clean; lint 0 errors.
<!-- end AUTH-034 -->

<!-- begin AUTH-036 -->
## AUTH-036 — Sign-in no longer uses the email

- Filed: 2026-10-19 12:19 UTC
- Status: **done**: login and verify bodies are phone-only and SMS-only; email paths removed
- Risk: high · story: [AUTH-036-sign-in-no-longer-uses-the-email.md](../modules/auth/AUTH-036-sign-in-no-longer-uses-the-email.md)
- Agent: 43,754 tokens, 14 tool uses, 2 min 16 s

### Agent report

**Summary:** Login and login/verify are phone-only, SMS-only; email, use_email and requestLoginByEmail removed.

**Decisions:**
- phone_number now required in both schemas (the refine on phone/email is gone), so email-only bodies fail as strict-schema 400.
- loginResponseSchema channel narrowed to the literal 'SMS' (openapi follows).

**Tests added beyond the story:**
- `login-sms-only.test.ts` › verify refused: email and phone: body with both fields stays 400 (AC-3); passed at once

**Other additions:**
- login-by-email.test.ts rewritten as refusal cases (right credentials, upper case, unverified, active number): per the Tests to update table.

**Evidence:** story tests 30/30; full suite 3291/3293, failing: pull-catalog.test.ts x2 (flaky under load, passes alone 7/7; unrelated), 0 known; typecheck clean; lint 0 errors, 137 warnings

**Follow-ups:**
- Baseline failures file was empty; the two pull-catalog failures look like load-dependent flakes.
<!-- end AUTH-036 -->

<!-- begin AUTH-035 -->
## AUTH-035 — Remove the verified-email lookup

- Filed: 2026-10-19 12:21 UTC
- Status: **done**: findByVerifiedEmail removed; unit test guards export and src scan
- Risk: medium · story: [AUTH-035-remove-the-verified-email-lookup.md](../modules/auth/AUTH-035-remove-the-verified-email-lookup.md)
- Agent: 19,307 tokens, 10 tool uses, 1 min 19 s

### Agent report

**Summary:** Removed findByVerifiedEmail from the person repository; added a unit test for the missing export and a src/ scan.

**Decisions:**
- Contract entry: person contracts.md has no mention of the function, so nothing to edit there.

**Evidence:** story tests 2/2; full suite 3295/3295, failing: none, 0 known; typecheck clean; lint 0 errors, 139 warnings (existing style)
<!-- end AUTH-035 -->

<!-- begin AUTH-037 -->
## AUTH-037 — The active holder is told someone claimed their number

- Filed: 2026-10-19 12:22 UTC
- Status: **blocked**: Service done, 9 new tests pass, but existing number-claim.test.ts (named in the story command) now fails in its clean(): DELETE FROM people hits FK notifications_recipient_id_fkey because the claim now stores a notice. Needs 'DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM people WHERE phone_number LIKE ...)' in its clean(), to be listed under Tests to update.
- Risk: medium · story: [AUTH-037-the-active-holder-is-told-someone-claimed-their.md](../modules/auth/AUTH-037-the-active-holder-is-told-someone-claimed-their.md)
- Agent: 39,534 tokens, 18 tool uses, 1 min 29 s

### Agent report

**Summary:** Blocked: warnHolderOfClaim is implemented and its 9 tests pass, but the existing number-claim.test.ts (in the story's command) now fails in its own clean().

**Decisions:**
- Warning called only for `RECENTLY_ACTIVE`, after the existing refusal log, before the 409; a failure in it propagates (no swallowing), so the 409 would become 500 if Redis or the insert fails.
- Notice stored without organization or related entity; one `info` log `number_claim_warned` with the holder id only.

**Tests added beyond the story:**
- `number-claim-warning.test.ts` › empty language preference gives French: default language (recipientLanguage contract); passed at once
- `number-claim-warning.test.ts` › claimant answer identical whether warned or not: AC "same 409 body"; passed at once
- `number-claim-warning.test.ts` › log carries holder id, never the number: AC-16.3.1 security text; passed at once

**Evidence:** story tests 9/9 new pass; number-claim.test.ts suite fails at afterAll/beforeEach clean() (FK notifications_recipient_id_fkey); full suite not run; typecheck clean; lint 0 errors, 0 warnings on changed files

**Follow-ups:**
- Question: may number-claim.test.ts `clean()` get `DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM people WHERE phone_number LIKE '+237677124%')` before the people delete? The story does not list it under Tests to update, so I did not touch it. Add it to the story, then rerun.
<!-- end AUTH-037 -->

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
