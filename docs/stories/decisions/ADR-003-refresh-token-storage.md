# ADR-003: Stateless access tokens and hashed refresh tokens

Status: accepted

## Context
Before the story workflow, the Spec Kit feature 005-refresh-tokens decided how sessions are revoked and how refresh tokens are stored. `src/middleware/auth.ts` and `src/lib/refresh-token.ts` cited its research notes, which were never in git and are now archived outside the repository. This record keeps those two decisions in the repository.

## Decision
1. Access token: a JWT signed with HS256, valid 15 minutes by default (`ACCESS_TOKEN_EXPIRES_IN`), verified by its signature alone, with no database lookup per request. Revocation happens at the refresh-token layer: a revoked or locked account cannot obtain further access tokens.
2. Refresh token: 32 random bytes from `crypto.randomBytes`, base64url-encoded and returned as-is; the server stores only its SHA-256 hash. A fast hash fits a 256-bit random secret, which cannot be brute-forced; slow hashing (Argon2id) stays for low-entropy secrets: passwords and one-time codes.

Rejected: a database check or a Redis denylist on every request (a round-trip for a problem the short lifetime and the refresh layer already solve); slow hashing of refresh tokens (latency without a security gain); refresh tokens as JWTs (not individually revocable without a database).

## Consequences
- A leaked access token stays valid until it expires, at most 15 minutes by default.
- Revoking or rotating refresh tokens (AUTH-008, AUTH-016, AUTH-017) ends a session.
