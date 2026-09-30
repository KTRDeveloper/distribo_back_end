# ADR-002: New dependencies

Status: accepted

## Context
The stack comes from the existing code (Node.js 22, TypeScript 5.9, Express 5.1, Prisma 7, Zod 3, Vitest 4, Pino 10, Redis, BullMQ), not from the skill defaults. The design names mechanisms the code does not yet use. The allowlist forbids any other package.

## Decision
Add these packages, versions read from the npm registry on 2026-09-30:

| package | version | used for | design line |
|---|---|---|---|
| `@casl/ability` | 7.0.1 | rules table evaluation | 1024 |
| `argon2` | 0.45.1 | Argon2id password hashing | 63 |
| `libphonenumber-js` | 1.13.14 | E.164 normalization, mobile numbers only | 114 |
| `uuid` | 14.0.2 | UUIDv7 identifiers (`v7()`) | 9 |
| `otplib` | 13.5.0 | TOTP for administrators | 781 |

Removed later: `bcrypt`, once Argon2id replaces it (no real data exists, see Q-001), so no story keeps it. Not added: any push, Play Integrity or App Attest package (Q-007, Q-008).

## Consequences
- Each story that uses one of these lists it in its `dependencies` field; FND-000 puts the exact versions in the allowlist.
- If you refuse a package, the stories that use it become open questions.
