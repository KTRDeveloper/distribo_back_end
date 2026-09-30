---
id: AUTH-006
title: Access token carries the person and the device
module: auth
kind: change
rev: 1
amends: [FND-001]
size: S
risk: high
depends_on: [PER-002, FND-006]
read_first: [src/lib/jwt.ts, src/middleware/auth.ts]
design_refs: [acces-et-securite/refreshtoken, identite-et-organisation/person]
constraints: [CM-08]
asvs: [v5.0.0-9.1.1, v5.0.0-9.1.2, v5.0.0-9.2.1, v5.0.0-9.2.2]
---

# AUTH-006 — Access token carries the person and the device

## Story
Technical story: put the person id and the device id in the access token and stop putting the phone number in it, so that the token is small, private and tied to one session.

## Context
- Exists: `signToken({ accountId, phoneNumber })` and `verifyToken` in `src/lib/jwt.ts`; `authMiddleware` sets `req.user = { id, phoneNumber }`; `src/types/express.d.ts`; `tests/helpers/request.ts` signs `{ accountId, tokenVersion }`.
- Changes: the payload is `{ sub: personId, did: deviceId, typ: 'access' }`, signed HS256, lifetime from `ACCESS_TOKEN_EXPIRES_IN` (default 15m); verification accepts only HS256 and requires `sub`, `did` and `typ` = access; `req.user = { id: sub, deviceId: did }`.
- The test helpers sign the new payload; a helper argument `deviceId` defaults to a fixed UUID.
- `CM-08`: Access token (JWT) lives 15 minutes and is not stored; refresh token lives 90 days, extended at each use, replaced at each use; a reused token revokes only its own device session (REUSE_DETECTED).

## Acceptance criteria
```gherkin
Scenario: AC-1 New payload
  When signAccessToken signs for a person and a device
  Then the decoded payload has `sub`, `did`, `typ` access, `iat`, `exp` 15 minutes later and no phone number
Scenario Outline: AC-2 Verification
  When verifyAccessToken receives <token>
  Then the result is <result>
  Examples:
    | token                                            | result   |
    | a fresh valid token                              | accepted |
    | an expired token                                 | rejected |
    | signed with another secret                       | rejected |
    | algorithm none                                   | rejected |
    | signed HS512 with the right secret               | rejected |
    | missing `did`                                    | rejected |
    | `typ` refresh                                    | rejected |
Scenario: AC-3 Middleware
  When a request carries a valid token
  Then `req.user` is `{ id, deviceId }` and the next handler runs
  And an invalid token answers 401 `INVALID_TOKEN`, a missing header 401 `UNAUTHORIZED`
```

## Abuse cases
```gherkin
Scenario: AB-1 Algorithm confusion (spoofing)
  When a token with `alg: none` or signed HS512 is presented
  Then the response is 401 `INVALID_TOKEN`
```

## Implementation
- Create: `tests/unit/auth/access-token.test.ts`
- Modify: `src/lib/jwt.ts`, `src/middleware/auth.ts`, `src/types/express.d.ts`, `tests/helpers/request.ts`
- Pattern: `src/lib/jwt.ts`
- Signatures:
  - `signAccessToken(payload: { personId: string; deviceId: string }): string`
  - `verifyAccessToken(token: string): { personId: string; deviceId: string }`
- Types:
  - `req.user: { id: string; deviceId: string }`
- Errors: `INVALID_TOKEN` 401, `UNAUTHORIZED` 401
- Dependencies: `jsonwebtoken`, `express`

## Security
- v5.0.0-9.1.2: `jwt.verify` is called with `algorithms: ['HS256']`.
- v5.0.0-9.2.2: `typ` must be `access`.
- v5.0.0-9.1.1: the signature is checked before any claim is read.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| payload | unit | AC-1, CM-08 | sign → decoded claims, no phone, 15 minute expiry |
| verification | unit | AC-2 | each Examples row → accepted or rejected |
| middleware | integration | AC-3 | valid → req.user set; invalid → INVALID_TOKEN; none → UNAUTHORIZED |
| algorithm confusion | security | AB-1, WSTG-SESS-10, CWE-347 | none and HS512 tokens → 401 |

Command: `npx vitest run tests/unit/auth/access-token.test.ts tests/integration/user.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/helpers/request.ts | signs `{ accountId, tokenVersion }` | signs `{ sub, did, typ: 'access' }` |

## Out of scope
- Issuing tokens at login (AUTH-008).
