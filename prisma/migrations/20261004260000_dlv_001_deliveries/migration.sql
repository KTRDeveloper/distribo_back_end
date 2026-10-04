-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "assigned_to_id" UUID NOT NULL,
    "departed_at" TIMESTAMPTZ,
    "arrived_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "failure_reason" TEXT,
    "sync_issue" TEXT,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliveries_order_id_idx" ON "deliveries"("order_id");

-- CreateIndex
CREATE INDEX "deliveries_assigned_to_id_departed_at_idx" ON "deliveries"("assigned_to_id", "departed_at");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The driver must be a registered person (C-04). Checked at commit, like the
-- other author columns.
CREATE CONSTRAINT TRIGGER "deliveries_require_registered_person"
AFTER INSERT OR UPDATE ON "deliveries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('assigned_to_id');

CREATE TRIGGER "deliveries_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "deliveries"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
