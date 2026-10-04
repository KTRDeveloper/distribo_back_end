-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "paid_by_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by_id" UUID,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expenses_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "expenses_cancellation_together_check"
        CHECK (("cancelled_at" IS NULL) = ("cancelled_by_id" IS NULL))
);

-- CreateIndex
CREATE INDEX "expenses_organization_id_occurred_at_idx" ON "expenses"("organization_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "expenses_paid_by_id_idx" ON "expenses"("paid_by_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The people who recorded and cancelled an expense must be registered people.
-- Checked at commit, like the other author columns (C-04).
CREATE CONSTRAINT TRIGGER "expenses_require_registered_person"
AFTER INSERT OR UPDATE ON "expenses"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('paid_by_id', 'recorded_by_id', 'cancelled_by_id');

-- The payer must have a collaboration row in the organization, whatever its
-- status or deletion state (C-27). This runs before the NOT NULL and foreign
-- key checks, so it steps aside when a value is missing or the organization
-- does not exist and lets those checks report their own error.
CREATE FUNCTION expenses_require_payer_collaborator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.paid_by_id IS NULL OR NEW.organization_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.organization_id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM collaborations
    WHERE person_id = NEW.paid_by_id AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'expense payer is not a collaborator of the organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "expenses_require_payer_collaborator"
BEFORE INSERT ON "expenses"
FOR EACH ROW EXECUTE FUNCTION expenses_require_payer_collaborator();

-- An expense is never edited: the only allowed change is to set cancelled_at
-- and cancelled_by_id once, from null (C-27). Every other column, including
-- deleted_at, must stay as it is; server_updated_at is managed by the database.
CREATE FUNCTION expenses_cancel_once_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'server_updated_at' - 'cancelled_at' - 'cancelled_by_id')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'server_updated_at' - 'cancelled_at' - 'cancelled_by_id') THEN
    RAISE EXCEPTION 'an expense cannot be edited, only cancelled'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.cancelled_at IS NOT NULL
     AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
          OR NEW.cancelled_by_id IS DISTINCT FROM OLD.cancelled_by_id) THEN
    RAISE EXCEPTION 'an expense can be cancelled only once'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "expenses_cancel_once_only"
BEFORE UPDATE ON "expenses"
FOR EACH ROW EXECUTE FUNCTION expenses_cancel_once_only();

CREATE TRIGGER "expenses_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "expenses"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
