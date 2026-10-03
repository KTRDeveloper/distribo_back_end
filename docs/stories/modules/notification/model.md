# Model: notification

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Notification
Design: `notifications/notification`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| recipient_id | FK → Person | Notification:fk |
| organization_id | FK → Organization, nullable | Notification:fk |
| content | text | nonblank, at most 2000 characters |
| source_event | string | canonical lowercase dotted snake-case, at most 100 characters |
| related_entity_type | string, nullable | C-30; nonblank and at most 100 characters when present |
| related_entity_id | FK, nullable, polymorphe | C-30 |
| read_status | enum [UNREAD / READ] | Notification.read_status:enum |
| pushed_at | datetime, nullable |  |
| created_at | datetime |  |

- `Notification:required`: NOT NULL: `recipient_id`, `content`, `source_event`, `read_status`, `created_at`
- `Notification.read_status:enum`: one of UNREAD, READ
- `Notification:fk`: references recipient_id → Person; organization_id → Organization
- `C-30`: `Notification` recipient is a registered person; `related_entity_type` and `related_entity_id` are both set or both empty.
- `content`: surrounding whitespace is preserved, but the value is nonblank after trimming and has at most 2000 characters.
- `source_event`: an untrimmed name of at most 100 characters matching `^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$`.
- `related_entity_type`: when present, it is nonblank after trimming and has at most 100 characters.
