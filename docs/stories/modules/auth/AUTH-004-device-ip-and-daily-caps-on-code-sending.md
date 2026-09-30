---
id: AUTH-004
title: Device, IP and daily caps on code sending
module: auth
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [AUTH-003]
read_first: [src/modules/auth/otp.service.ts, src/lib/config-service.ts]
design_refs: [acces-et-securite/otpchallenge]
constraints: [CM-07]
asvs: [v5.0.0-2.4.1, v5.0.0-16.3.3]
---

# AUTH-004 — Device, IP and daily caps on code sending

## Story
Technical story: cap code sending per device, per IP address and per day, so that a flood spread over many numbers still stops.

## Context
- Exists: `issueCode` with the per-number limits (AUTH-002); `configService.get(category, key)` returns null when unset (Q-006).
- Adds: optional `clientKeys: { deviceId?: string; ip?: string }` on `issueCode`. Limits come from remote-config category `otp`: `max_per_device_per_hour`, `max_per_ip_per_hour`, `max_per_day`. A limit that is unset is off.
- Counters: `otp:device:<deviceId>`, `otp:ip:<ip>` (window 3600 s), `otp:day` (window 86400 s). A refusal is 429 `OTP_RATE_LIMITED`.
- When the daily cap is reached the first time in a day, log `error` with event `otp_daily_cap_reached` and increment Prometheus counter `otp_daily_cap_reached_total` (Q-009).
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Caps
  Given cap <cap> is set to 2 and unset caps are off
  When 3 codes are requested for different numbers with the same <key>
  Then the third is <result>
  Examples:
    | cap                    | key       | result              |
    | max_per_device_per_hour| device id | 429 OTP_RATE_LIMITED|
    | max_per_ip_per_hour    | ip        | 429 OTP_RATE_LIMITED|
    | max_per_day            | any       | 429 OTP_RATE_LIMITED|
Scenario: AC-2 Caps unset
  When no cap is configured and 50 codes are requested from one device
  Then no request is refused by these caps
Scenario: AC-3 Alert
  When the daily cap is reached
  Then one `error` log with event `otp_daily_cap_reached` and one counter increment exist for that day
```

## Abuse cases
```gherkin
Scenario: AB-1 Distributed SMS pumping (denial of service)
  When one device requests codes for 20 valid numbers with a per-device cap of 5
  Then only 5 are queued
```

## Implementation
- Create: `tests/integration/auth/otp-caps.test.ts`
- Modify: `src/modules/auth/otp.service.ts`, `src/lib/metrics.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Signatures:
  - `issueCode(input: IssueCodeInput, clientKeys?: { deviceId?: string; ip?: string }): Promise<{ challengeId: string; expiresAt: Date }>`
- Errors: `OTP_RATE_LIMITED` 429
- Dependencies: `ioredis`, `prom-client`

## Security
- v5.0.0-2.4.1: caps are read at each call, so an operator can change them without a deploy.
- v5.0.0-16.3.3: reaching the daily cap is logged with a fixed event name.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| caps | integration | AC-1, CM-07 | each Examples row → third request 429 |
| unset caps | integration | AC-2 | 50 requests → none refused by caps |
| alert | integration | AC-3 | daily cap reached → one error log, counter +1 |
| distributed pumping | security | AB-1, WSTG-BUSL-07, CWE-770 | cap 5, 20 numbers → 5 queued |

Command: `npx vitest run tests/integration/auth/otp-caps.test.ts`

## Out of scope
- Choosing the cap values (Q-006, set by an operator in remote-config).
