# Contracts: auth

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### OtpService (`src/modules/auth/otp.service.ts`, created by AUTH-002)
- `issueCode(input: IssueCodeInput, clientKeys?: ClientKeys): Promise<{ challengeId: string; expiresAt: Date }>`: IssueCodeInput = { personId: string | null; target: string; purpose: OtpPurpose; channel: OtpChannel; contact?: { id: string; organizationName: string } }; contact is required with the purpose ORG_CONTACT_VERIFICATION and refused with any other (ORG-041)
- `verifyCode(input: { target: string; purpose: OtpPurpose; code: string; organizationContactId?: string }): Promise<{ challengeId: string; personId: string | null }>`: organizationContactId is required with ORG_CONTACT_VERIFICATION and refused with any other (ORG-041)
- Used by: `admin`, `organization`
### PasswordLib (`src/lib/password.ts`, created by AUTH-005)
- `hashPassword(plain: string): Promise<string>`: Argon2id
- `verifyPassword(hash: string, plain: string): Promise<boolean>`
- `validatePasswordRules(plain: string): Promise<string[]>`: list of broken rule codes, empty when valid
- Used by: `admin`
### SessionService (`src/modules/auth/session.service.ts`, created by AUTH-008)
- `issueSession(personId: string, device: DeviceInfo, tx?): Promise<SessionTokens>`
- `revokeSessions(personId: string, reason: RevokedReason, options?: { exceptDeviceId?: string }): Promise<number>`
- Used by: `admin`, `sync`
### SupportAccess (`src/modules/auth/support-access.service.ts`, created by ADM-017)
- `releaseNumberOfPerson(tx: Prisma.TransactionClient, personId: string): Promise<string | null>`: releases the active number of a registered person as a recycled-number claim does and returns it; null for a guest or a person with no active number (ADM-017)
- `moveAccountToNumber(tx: Prisma.TransactionClient, personId: string, newPhone: string): Promise<boolean>`: replaces the active number and writes the PhoneNumberChangeLog row; false when the person has no number to replace; throws on a number taken (ADM-020)
- Used by: `admin`
### AuthMiddleware (`src/middleware/auth.ts`, created by AUTH-006)
- `authMiddleware sets `req.user = { id: personId, deviceId }` from a verified HS256 access token`
- Used by: `every module`

## Consumes
- person: PersonRepository, `people` table (docs/stories/modules/person/contracts.md)
- notification: notify, recipientLanguage (docs/stories/modules/notification/contracts.md)
- foundation: normalizeE164, isCameroonMobile, newId, httpError (docs/stories/modules/foundation/contracts.md)
