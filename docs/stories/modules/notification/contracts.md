# Contracts: notification

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### NotificationService (`src/modules/notification/notification.service.ts`, created by NTF-002)
- `notify(input: NotifyInput, tx?: Prisma.TransactionClient): Promise<void>`: stores one unread notification
- `recipientLanguage(personId: string): Promise<'FR' | 'EN'>`: preferred language, FR when empty
- Used by: `auth`, `organization`, `relationship`, `order`, `finance`, `delivery`, `admin`, `sync`
### retargetNotifications (`src/modules/notification/notification.service.ts`, created by NTF-005)
- `retargetNotifications(tx: Prisma.TransactionClient, input: { type: string; fromId: string; toId: string }): Promise<number>`: points every notification about one entity at its replacement; returns how many moved
- Used by: `order`

## Consumes
- person: PER-008 require_registered_person trigger (docs/stories/modules/person/contracts.md)
- foundation: newId, paginationQuerySchema, httpError (docs/stories/modules/foundation/contracts.md)
