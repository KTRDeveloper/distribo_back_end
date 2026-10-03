CREATE TYPE "NotificationReadStatus" AS ENUM ('UNREAD', 'READ');

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "organization_id" UUID,
    "content" TEXT NOT NULL,
    "source_event" TEXT NOT NULL,
    "related_entity_type" TEXT,
    "related_entity_id" UUID,
    "read_status" "NotificationReadStatus" NOT NULL DEFAULT 'UNREAD',
    "pushed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_related_entity_pair_check" CHECK (
        ("related_entity_type" IS NULL AND "related_entity_id" IS NULL)
        OR ("related_entity_type" IS NOT NULL AND "related_entity_id" IS NOT NULL)
    ),
    CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id")
        REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "notifications_recipient_id_read_status_created_at_idx"
    ON "notifications"("recipient_id", "read_status", "created_at" DESC);

CREATE CONSTRAINT TRIGGER "notifications_require_registered_recipient"
AFTER INSERT OR UPDATE ON "notifications"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('recipient_id');

CREATE TRIGGER "notifications_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "notifications"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
