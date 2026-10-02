-- CreateTable
CREATE TABLE "phone_number_change_logs" (
    "id" UUID NOT NULL,
    "person_id" TEXT NOT NULL,
    "old_phone_number" TEXT NOT NULL,
    "new_phone_number" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "phone_number_change_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "phone_number_change_logs_old_phone_number_e164_check"
      CHECK ("old_phone_number" ~ '^\+[1-9][0-9]{1,14}$'),
    CONSTRAINT "phone_number_change_logs_new_phone_number_e164_check"
      CHECK ("new_phone_number" ~ '^\+[1-9][0-9]{1,14}$')
);

-- CreateIndex
CREATE INDEX "phone_number_change_logs_person_id_idx"
ON "phone_number_change_logs"("person_id");

-- AddForeignKey
ALTER TABLE "phone_number_change_logs"
ADD CONSTRAINT "phone_number_change_logs_person_id_fkey"
FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep synchronized journal timestamps under database control.
CREATE TRIGGER "phone_number_change_logs_server_updated_at_trigger"
BEFORE INSERT OR UPDATE ON "phone_number_change_logs"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();

-- Journal entries are append-only for the application account (C-32/C-39).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "phone_number_change_logs" FROM distribo_app;
