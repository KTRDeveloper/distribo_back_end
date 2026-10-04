-- CreateTable
-- Immutable archive of every received sync batch (C-32, CM-35: kept 90 days).
CREATE TABLE "sync_archives" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changes" JSONB NOT NULL,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_archives_person_id_received_at_idx"
    ON "sync_archives"("person_id", "received_at" DESC);
CREATE INDEX "sync_archives_device_id_idx" ON "sync_archives"("device_id");
CREATE INDEX "admin_actions_sync_archive_id_idx" ON "admin_actions"("sync_archive_id");

-- AddForeignKey
ALTER TABLE "sync_archives"
    ADD CONSTRAINT "sync_archives_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sync_archives"
    ADD CONSTRAINT "sync_archives_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- A journal entry that replays a batch must point to a real archive (ADM-002
-- left sync_archive_id as a plain column until this table existed).
ALTER TABLE "admin_actions"
    ADD CONSTRAINT "admin_actions_sync_archive_id_fkey"
    FOREIGN KEY ("sync_archive_id") REFERENCES "sync_archives"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- server_updated_at is set by the server on every write (C-35).
CREATE TRIGGER "sync_archives_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "sync_archives"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();

-- The application account can only add and read archives (C-32, C-39).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "sync_archives" FROM distribo_app;
