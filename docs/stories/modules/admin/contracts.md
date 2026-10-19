# Contracts: admin

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### AdminJournal (`src/modules/admin/admin.repository.ts`, created by ADM-002)
- `recordAdminAction(tx, input: { administratorId: string; action: AdminActionType; targetPersonId?: string; targetOrganizationId?: string; reportId?: string; syncArchiveId?: string; reason: string }): Promise<AdminAction>`
- Used by: `sync`
### AdminAuth (`src/middleware/admin-auth.ts`, created by ADM-006)
- `adminAuthMiddleware: RequestHandler`: verifies an admin-typed access token and a live Administrator; sets `req.admin = { administratorId, personId, role }`
- `requireAdminRole(min: 'MODERATOR' | 'SUPER_ADMIN'): RequestHandler`
- Used by: `sync`

## Consumes
- auth: issue and verify one-time codes (issueCode, verifyCode), hashPassword and verifyPassword, revokeSessions, releaseNumberOfPerson, moveAccountToNumber (docs/stories/modules/auth/contracts.md)
- person: findByActivePhone, toPublicPerson (docs/stories/modules/person/contracts.md)
- notification: notify (docs/stories/modules/notification/contracts.md)
