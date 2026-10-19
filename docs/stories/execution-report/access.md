# Execution report: access

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

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
