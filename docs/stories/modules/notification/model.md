# Model: notification

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Notification
Design: `notifications/notification`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| recipient_id | FK → Person | Notification:fk |
| organization_id | FK → Organization, nullable | Notification:fk |
| content | text |  |
| source_event | string |  |
| related_entity_type | string, nullable | C-30 |
| related_entity_id | FK, nullable, polymorphe | C-30 |
| read_status | enum [UNREAD / READ] | Notification.read_status:enum |
| pushed_at | datetime, nullable |  |
| created_at | datetime |  |

- `Notification:required`: NOT NULL: `recipient_id`, `content`, `source_event`, `read_status`, `created_at`
- `Notification.read_status:enum`: one of UNREAD, READ
- `Notification:fk`: references recipient_id → Person; organization_id → Organization
- `C-30`: `Notification` recipient is a registered person; `related_entity_type` and `related_entity_id` are both set or both empty.
