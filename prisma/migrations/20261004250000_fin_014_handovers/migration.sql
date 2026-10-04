-- CreateTable
CREATE TABLE "handovers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "from_person_id" UUID NOT NULL,
    "to_person_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by_id" UUID,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "handovers_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "handovers_cancellation_together_check"
        CHECK (("cancelled_at" IS NULL) = ("cancelled_by_id" IS NULL))
);

-- CreateIndex
CREATE INDEX "handovers_organization_id_occurred_at_idx" ON "handovers"("organization_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "handovers_from_person_id_idx" ON "handovers"("from_person_id");

-- CreateIndex
CREATE INDEX "handovers_to_person_id_idx" ON "handovers"("to_person_id");

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_from_person_id_fkey" FOREIGN KEY ("from_person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_to_person_id_fkey" FOREIGN KEY ("to_person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sender, receiver and canceller must be registered people (C-04). Checked at
-- commit, like the other author columns.
CREATE CONSTRAINT TRIGGER "handovers_require_registered_person"
AFTER INSERT OR UPDATE ON "handovers"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('to_person_id', 'cancelled_by_id', 'from_person_id');

-- The sender needs a collaboration row in the organization, whatever its
-- status or deletion state; the receiver needs an ACTIVE OWNER or MANAGER
-- collaboration there (C-27). Sender and receiver may be the same person (the
-- former owner's automatic handover); the routes refuse that case. This runs
-- before the NOT NULL and foreign key checks, so it steps aside when a value
-- is missing or the organization does not exist and lets those checks report.
CREATE FUNCTION handovers_require_party_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.from_person_id IS NULL OR NEW.to_person_id IS NULL OR NEW.organization_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.organization_id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM collaborations
    WHERE person_id = NEW.from_person_id AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'handover sender is not a collaborator of the organization'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM collaborations
    WHERE person_id = NEW.to_person_id AND organization_id = NEW.organization_id
      AND status = 'ACTIVE' AND role IN ('OWNER', 'MANAGER')
  ) THEN
    RAISE EXCEPTION 'handover receiver is not an active owner or manager of the organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "handovers_require_party_roles"
BEFORE INSERT ON "handovers"
FOR EACH ROW EXECUTE FUNCTION handovers_require_party_roles();

-- A handover is never edited: the only allowed change is to set cancelled_at
-- and cancelled_by_id once, from null (C-27). Every other column, including
-- deleted_at, must stay as it is; server_updated_at is managed by the database.
CREATE FUNCTION handovers_cancel_once_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'server_updated_at' - 'cancelled_at' - 'cancelled_by_id')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'server_updated_at' - 'cancelled_at' - 'cancelled_by_id') THEN
    RAISE EXCEPTION 'a handover cannot be edited, only cancelled'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.cancelled_at IS NOT NULL
     AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
          OR NEW.cancelled_by_id IS DISTINCT FROM OLD.cancelled_by_id) THEN
    RAISE EXCEPTION 'a handover can be cancelled only once'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "handovers_cancel_once_only"
BEFORE UPDATE ON "handovers"
FOR EACH ROW EXECUTE FUNCTION handovers_cancel_once_only();

CREATE TRIGGER "handovers_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "handovers"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
