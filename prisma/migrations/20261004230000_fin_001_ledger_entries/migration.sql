-- CreateEnum
CREATE TYPE "LedgerEntryKind" AS ENUM ('SALE', 'PAYMENT', 'REFUND', 'CREDIT_NOTE', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "LedgerEntryMode" AS ENUM ('CASH', 'MOBILE_MONEY');

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "customer_relationship_id" UUID NOT NULL,
    "order_id" UUID,
    "kind" "LedgerEntryKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    -- Computed by the database, never written by the application (C-23):
    -- SALE, OPENING_BALANCE and REFUND add the amount, PAYMENT and CREDIT_NOTE
    -- subtract it; an entry that reverses another has the opposite sign.
    "balance_effect" BIGINT GENERATED ALWAYS AS (
        CASE WHEN "reverses_entry_id" IS NULL THEN 1 ELSE -1 END
        * CASE WHEN "kind" IN ('SALE', 'OPENING_BALANCE', 'REFUND') THEN "amount" ELSE -"amount" END
    ) STORED,
    "mode" "LedgerEntryMode",
    "transaction_reference" TEXT,
    "reverses_entry_id" UUID,
    "recorded_by_id" UUID NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_entries_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "ledger_entries_mode_matches_kind_check"
        CHECK (("mode" IS NOT NULL) = ("kind" IN ('PAYMENT', 'REFUND')))
);

-- CreateIndex
CREATE INDEX "ledger_entries_customer_relationship_id_occurred_at_idx" ON "ledger_entries"("customer_relationship_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "ledger_entries_recorded_by_id_occurred_at_idx" ON "ledger_entries"("recorded_by_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_relationship_id_fkey" FOREIGN KEY ("customer_relationship_id") REFERENCES "customer_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The author of an entry must be a registered person. Checked at commit,
-- like the other author columns (C-04).
CREATE CONSTRAINT TRIGGER "ledger_entries_require_registered_person"
AFTER INSERT OR UPDATE ON "ledger_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('recorded_by_id');

CREATE TRIGGER "ledger_entries_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();

-- The ledger is append-only for the application account (C-39).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "ledger_entries" FROM distribo_app;
