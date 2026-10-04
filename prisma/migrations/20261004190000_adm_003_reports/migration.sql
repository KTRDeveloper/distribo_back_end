-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReportDecision" AS ENUM ('DISMISSED', 'SUSPENSION');

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_person_id" UUID,
    "target_organization_id" UUID,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "reported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by_id" UUID,
    "decision" "ReportDecision",
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id"),
    -- Exactly one target: a person or an organization (C-28, v5.0.0-2.2.3).
    CONSTRAINT "reports_exactly_one_target"
        CHECK (("target_person_id" IS NULL) <> ("target_organization_id" IS NULL))
);

-- CreateIndex
CREATE INDEX "reports_reporter_id_idx" ON "reports"("reporter_id");
CREATE INDEX "reports_target_person_id_idx" ON "reports"("target_person_id");
CREATE INDEX "reports_target_organization_id_idx" ON "reports"("target_organization_id");
CREATE INDEX "reports_resolved_by_id_idx" ON "reports"("resolved_by_id");

-- AddForeignKey
ALTER TABLE "reports"
    ADD CONSTRAINT "reports_reporter_id_fkey"
    FOREIGN KEY ("reporter_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reports"
    ADD CONSTRAINT "reports_target_person_id_fkey"
    FOREIGN KEY ("target_person_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reports"
    ADD CONSTRAINT "reports_target_organization_id_fkey"
    FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reports"
    ADD CONSTRAINT "reports_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "administrators"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The reporter must be a registered person, never a guest. Checked at commit,
-- like the other author columns (C-04). It runs after the foreign key, so an
-- unknown person id fails with 23503 first.
CREATE CONSTRAINT TRIGGER "reports_require_registered_reporter"
AFTER INSERT OR UPDATE ON "reports"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('reporter_id');

CREATE TRIGGER "reports_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "reports"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();

-- A journal entry that mentions a report must point to a real one (ADM-002
-- left report_id as a plain column until this table existed).
CREATE INDEX "admin_actions_report_id_idx" ON "admin_actions"("report_id");

ALTER TABLE "admin_actions"
    ADD CONSTRAINT "admin_actions_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "reports"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
