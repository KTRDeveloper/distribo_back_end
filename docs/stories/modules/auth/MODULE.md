# Module Authentication (`auth`)

Owns registration, login with a code on every sign-in, one session per phone, password and email and phone-number changes, and the one-time codes behind them.

- Story prefix: `AUTH` · ASVS L2: Accounts and sessions protect business and money data; sign-in needs the password and the SIM, and codes cost money to send.
- Depends on: `foundation`, `person`, `notification`, `access`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `OtpChallenge` (design `acces-et-securite/otpchallenge`)
- `Device` (design `acces-et-securite/device`)
- `RefreshToken` (design `acces-et-securite/refreshtoken`)

## Data classification
| data | class | handling |
|---|---|---|
| Person.password_hash | credential | Argon2id hash, never returned or logged |
| OtpChallenge.code_hash | credential | hash only, never logged |
| OtpChallenge.target | PII | phone number or email, never logged |
| RefreshToken.token_hash | credential | SHA-256 hash of a random token, never logged |
| Device.push_token | credential | stored, never returned to others |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | S | Password guessing or credential stuffing | 5 failures lock the account for LOGIN_LOCK_MINUTES, a code is needed anyway | AUTH-013 AB-1 |
| T2 | S | Code guessing | 5 attempts per code, single use, 10 minute expiry | AUTH-003 AB-1 |
| T3 | D | SMS pumping and code flooding | +237 only, 3 per hour per number, 60 seconds apart, device and IP caps | AUTH-002 AB-1, AUTH-004 AB-1 |
| T4 | S | Stolen refresh token replayed | rotation at every use, reuse revokes that device | AUTH-016 AB-1 |
| T5 | I | Account enumeration by number checks | sign-in and registration tell the user what to do (no account, wrong password), so every number check counts in a per-IP limit and nothing private is shown before the code | AUTH-028 AB-1, AUTH-029 AB-1 |
| T6 | E | Recycled number lets a new holder take the old account | the new holder gets a new person; the old one keeps the account and history | AUTH-011 AB-1 |
| T7 | R | Sensitive account changes leave no trace | login alerts, immutable number-change journal, security log events | AUTH-014 AB-2, AUTH-025 AB-2 |
| T8 | D | Claiming a number to harass its active holder | the claim is refused when the old account synced in the last 6 months or is suspended, with one message for both; the holder is warned at most once a day | AUTH-031 AB-1, AUTH-032 AB-1 |

## Pointers
- Conventions: `docs/stories/CONVENTIONS.md`
