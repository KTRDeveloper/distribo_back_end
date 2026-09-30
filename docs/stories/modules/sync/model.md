# Model: sync

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## SyncArchive
Design: `synchronisation-hors-ligne/syncarchive`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| person_id | FK → Person | SyncArchive:fk |
| device_id | FK → Device | SyncArchive:fk |
| received_at | datetime |  |
| changes | JSON | CM-32 |

- `SyncArchive:required`: NOT NULL: `person_id`, `device_id`, `received_at`, `changes`
- `SyncArchive:fk`: references person_id → Person; device_id → Device
- `C-32`: Immutable journals are never updated or deleted by the application; only the retention purge removes them.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.
- `CM-32`: Only a SUPER_ADMIN replays an archived batch, with a mandatory reason, logged as REPLAY_SYNC; it is judged as if sent by its author with their current rights, never the administrator's; the author and the owner are notified.
