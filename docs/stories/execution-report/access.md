# Execution report: access

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-19 12:22 UTC: `/implement-stories ACC-008,AUTH-027..AUTH-038`

| story | status | commit | note |
|---|---|---|---|
| ACC-008 Availability values say who may act offline | done | d766874 | Where values renamed, unknown value denied; 3206 tests pass |

Also in this run: auth.

- Not done: AUTH-037, blocked. Its new tests pass, but the existing number-claim.test.ts (run by the story's own command) fails in clean(): a refused claim now stores a notice, so DELETE FROM people hits the notifications foreign key. The test is not under "Tests to update"; the fix is a DELETE FROM notifications before the people delete.
- Stash: "AUTH-037 blocked: partial changes".
- Earlier in this run: AUTH-028 and AUTH-032 were blocked the same way (an existing test missing from "Tests to update"); each was resolved by amending its story, popping the stash and re-running, and ended done. AUTH-028 also needed PRIV-002 AC-5 reworded.
- Run completed: every PLAN line reached; 12 done (ACC-008, AUTH-027..AUTH-036, AUTH-038), 1 blocked (AUTH-037), 0 skipped at the end.
- Baseline failing count: 0.
- Unexpected: the AUTH-032 first report was filed without figures (the notification arrived after the command); AUTH-037 was set aside before its report was filed; the AUTH-034, AUTH-032 and AUTH-036 hand-backs gave no or partial test evidence, so the orchestrator re-ran typecheck, lint and the full suite (all green); the AUTH-036 agent saw 2 sync/pull-catalog failures that did not reproduce. A story file was edited at the user's request (AUTH-028, PRIV-002, AUTH-032).
- Follow-up for a human: contracts.md of the auth module does not list claimRefusal (AUTH-031).
- Next command: amend AUTH-037's "Tests to update" for number-claim.test.ts, `git stash pop` the AUTH-037 stash, then `/implement-stories AUTH-037`.

### Run 2026-10-19 11:57 UTC: `/implement-stories ACC-008,AUTH-027..AUTH-038`

| story | status | commit | note |
|---|---|---|---|
| ACC-008 Availability values say who may act offline | done | d766874 | Where values renamed, unknown value denied; 3206 tests pass |

Also in this run: auth.

- Skipped, dependency not done: AUTH-029, AUTH-033, AUTH-036 (need AUTH-028, blocked); AUTH-031 (needs AUTH-029), AUTH-032 (needs AUTH-031), AUTH-034 (needs AUTH-033), AUTH-035 (needs AUTH-036), AUTH-037 (needs AUTH-031). All stay todo.
- Stash: "AUTH-028 blocked: partial changes".
- Run completed: every PLAN line reached; 4 done (ACC-008, AUTH-027, AUTH-030, AUTH-038), 1 blocked (AUTH-028), 8 skipped.
- AUTH-028 needs a decision: tests/integration/privacy/anonymize.test.ts AC-5 (not in its "Tests to update") expects 401 for an anonymized number, now 404 ACCOUNT_NOT_FOUND. PRIV-002 AC-5 says "generic 401" and would need the same wording.
- Baseline failing count: 0.
- Nothing unexpected: all report files found, figures filed, every hand-back matched STATUS.md.
- Next command: once AUTH-028's "Tests to update" is amended, `git stash pop` the AUTH-028 stash, then `/implement-stories AUTH-028,AUTH-029,AUTH-031..AUTH-037`.

<!-- begin ACC-008 -->
## ACC-008 — Availability values say who may act offline

- Filed: 2026-10-19 11:49 UTC
- Status: **done**: Where values renamed, unknown value denied; 3206 tests pass
- Risk: high · story: [ACC-008-availability-values-say-who-may-act-offline.md](../modules/access/ACC-008-availability-values-say-who-may-act-offline.md)
- Agent: 31,177 tokens, 11 tool uses, 1 min 34 s

### Agent report

**Summary:** Renamed ONLINE/NETWORK to ONLINE_EXCEPT_OWNER/ONLINE_FOR_ALL in ability.ts and its tests; isAvailable now has a default branch returning false.

**Decisions:**
- Doc comments: added JSDoc on `Where` and `isAvailable` explaining each value and the deny-by-default branch.

**Tests added beyond the story:**
- `tests/unit/access/availability-names.test.ts` › unknown value also covers `NETWORK` and an empty string, not only ONLINE/ANYWHERE (AB-1); ONLINE and NETWORK failed before the change, the others passed at once.

**Other additions:**
- Prettier run reformatted ability.ts and ability.test.ts (formatting only, no expectation changed).

**Evidence:** story tests 98/98 in tests/unit/access; full suite 3206/3206, failing: none, 0 known; typecheck clean; lint 0 errors, 137 warnings
<!-- end ACC-008 -->
