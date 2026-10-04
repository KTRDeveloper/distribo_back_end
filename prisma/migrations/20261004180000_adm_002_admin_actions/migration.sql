-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM (
    'SUSPEND', 'REACTIVATE', 'DISMISS_REPORT', 'APPOINT_ADMIN', 'REMOVE_ADMIN',
    'REPLAY_SYNC', 'RECOVER_2FA'
);

-- CreateTable
-- report_id and sync_archive_id are plain columns for now: the foreign keys to
-- reports and sync archives come with ADM-003 and SYNC-002.
CREATE TABLE "admin_actions" (
    "id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "action" "AdminActionType" NOT NULL,
    "target_person_id" UUID,
    "target_organization_id" UUID,
    "report_id" UUID,
    "sync_archive_id" UUID,
    "reason" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id"),
    -- Exactly one target: a person or an organization (C-29).
    CONSTRAINT "admin_actions_exactly_one_target"
        CHECK (("target_person_id" IS NULL) <> ("target_organization_id" IS NULL)),
    -- A reason is always given and never blank (C-29).
    CONSTRAINT "admin_actions_reason_not_blank" CHECK (btrim("reason") <> ''),
    -- A sync archive is attached exactly when the action is REPLAY_SYNC (C-29).
    CONSTRAINT "admin_actions_sync_archive_only_for_replay"
        CHECK (("sync_archive_id" IS NOT NULL) = ("action" = 'REPLAY_SYNC'))
);

-- CreateIndex
CREATE INDEX "admin_actions_administrator_id_idx" ON "admin_actions"("administrator_id");
CREATE INDEX "admin_actions_target_person_id_idx" ON "admin_actions"("target_person_id");
CREATE INDEX "admin_actions_target_organization_id_idx" ON "admin_actions"("target_organization_id");

-- AddForeignKey
ALTER TABLE "admin_actions"
    ADD CONSTRAINT "admin_actions_administrator_id_fkey"
    FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admin_actions"
    ADD CONSTRAINT "admin_actions_target_person_id_fkey"
    FOREIGN KEY ("target_person_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admin_actions"
    ADD CONSTRAINT "admin_actions_target_organization_id_fkey"
    FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Replaying a sync archive is reserved to super administrators (C-29).
CREATE FUNCTION admin_actions_check_replay_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.action = 'REPLAY_SYNC' AND NOT EXISTS (
    SELECT 1
    FROM public.administrators
    WHERE id = NEW.administrator_id
      AND role = 'SUPER_ADMIN'
  ) THEN
    RAISE EXCEPTION 'REPLAY_SYNC requires a SUPER_ADMIN administrator'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "admin_actions_check_replay_role"
BEFORE INSERT OR UPDATE ON "admin_actions"
FOR EACH ROW EXECUTE FUNCTION admin_actions_check_replay_role();

CREATE TRIGGER "admin_actions_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "admin_actions"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();

-- The journal is append-only for the application account (C-32/C-39).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "admin_actions" FROM distribo_app;
