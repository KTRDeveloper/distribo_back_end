# Contracts: auth

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### OtpService (`src/modules/auth/otp.service.ts`, created by AUTH-002)
- `issueCode(input: { personId: string | null; target: string; purpose: OtpPurpose; channel: OtpChannel }): Promise<{ challengeId: string; expiresAt: Date }>`
- `verifyCode(input: { target: string; purpose: OtpPurpose; code: string }): Promise<{ challengeId: string; personId: string | null }>`
- Used by: `admin`
### PasswordLib (`src/lib/password.ts`, created by AUTH-005)
- `hashPassword(plain: string): Promise<string>`: Argon2id
- `verifyPassword(hash: string, plain: string): Promise<boolean>`
- `validatePasswordRules(plain: string): Promise<string[]>`: list of broken rule codes, empty when valid
- Used by: `admin`
### SessionService (`src/modules/auth/session.service.ts`, created by AUTH-008)
- `issueSession(personId: string, device: DeviceInfo, tx?): Promise<SessionTokens>`
- `revokeSessions(personId: string, reason: RevokedReason, options?: { exceptDeviceId?: string }): Promise<number>`
- Used by: `admin`, `sync`
### AuthMiddleware (`src/middleware/auth.ts`, created by AUTH-006)
- `authMiddleware sets `req.user = { id: personId, deviceId }` from a verified HS256 access token`
- Used by: `every module`

## Consumes
- person: PersonRepository, `people` table (docs/stories/modules/person/contracts.md)
- notification: notify, recipientLanguage (docs/stories/modules/notification/contracts.md)
- foundation: normalizeE164, isCameroonMobile, newId, httpError (docs/stories/modules/foundation/contracts.md)
