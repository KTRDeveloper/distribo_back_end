-- ORD-040: an order gets the four frozen receipt fields (expand step).
-- Nullable, no default, no check: existing orders keep them empty; the writer
-- (DLV-019), the backfill (ORD-042) and the rule tying them to DELIVERED (ORD-043) come later.
-- Amounts are bigint XAF (v5.0.0-2.2.1).
ALTER TABLE "orders"
    ADD COLUMN "supplier_name_applied" TEXT,
    ADD COLUMN "customer_name_applied" TEXT,
    ADD COLUMN "collected_applied" BIGINT,
    ADD COLUMN "balance_after_applied" BIGINT;
