---
id: AUTH-042
title: Only open sessions are listed and alerted
module: auth
kind: change
rev: 1
amends: [AUTH-014, AUTH-018]
size: S
risk: medium
depends_on: [AUTH-041]
read_first: [src/modules/auth/session.repository.ts, src/modules/auth/auth.service.ts]
design_refs: [a2-reconnaitre-un-telephone-android/sessions-ouvertes-precise-1-1-et-10-3]
constraints: []
asvs: [v5.0.0-7.5.2]
---

# AUTH-042 — Only open sessions are listed and alerted

## Story
As a customer, I want my devices list and new-login alerts to cover only my open sessions, so that a closed or expired phone never shows up or gets an alert.

## Context
- An open session is a device with `revoked_at` null whose current refresh token (`rotated_at` and `revoked_at` null) has `expires_at` in the future.
- Filter `listLive` (`session.repository.ts`) and `listLiveDeviceIds` (`auth.repository.ts`) on it.
- `completeLogin` (`auth.service.ts`) lists the devices to alert before `issueSession`: list them after it, excluding the device it just opened, so a device that login replaced (AUTH-041) gets no alert.
- The alert goes at every login, even on a recognized phone; its text is unchanged.

## Acceptance criteria
```gherkin
Scenario: AC-1 Expired sessions leave the list
  Given P has device D1 open and device D2 whose refresh token expired
  When P lists their devices
  Then only D1 is listed
Scenario: AC-2 The alert goes to the other open sessions
  Given P has open device D1 and expired device D2
  When P logs in on a new phone
  Then D1 gets the new-login alert and D2 does not
Scenario: AC-3 The replaced session gets no alert
  Given P has open device D1 and device D3 with android_id "a1b2c3d4"
  When P logs in again on the phone of D3
  Then D1 gets the alert, D3 is revoked and gets none
```

## Abuse cases
```gherkin
Scenario: AB-1 Another person's devices
  When P lists their devices
  Then no device of Q appears
```

## Implementation
- Create: `tests/integration/auth/open-sessions.test.ts`
- Modify: `src/modules/auth/session.repository.ts`, `src/modules/auth/auth.repository.ts`, `src/modules/auth/auth.service.ts`
- Pattern: `tests/integration/auth/devices.test.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-7.5.2: the person sees exactly the sessions that can still be used, to end the ones they do not know.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| expired | integration | AC-1 | only D1 |
| alert | integration | AC-2 | D1 alerted, D2 not |
| replaced | integration | AC-3 | D1 alerted, D3 not |
| other person | security | AB-1, WSTG-ATHZ-04 | no device of Q |

Command: `npx vitest run tests/integration/auth/open-sessions.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth/devices.test.ts | its listed devices all hold a live refresh token | unchanged: passes without edits |
| tests/integration/auth/login-verify.test.ts | the devices to alert are read after the session opens, excluding the new one | unchanged: passes without edits |

## Out of scope
- Closing the replaced session (AUTH-041).
