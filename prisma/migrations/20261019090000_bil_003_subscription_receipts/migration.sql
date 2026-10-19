-- CreateEnum
CREATE TYPE "ReceiptKind" AS ENUM ('RECEIPT', 'CREDIT_NOTE');

-- CreateTable
CREATE TABLE "subscription_receipts" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "ReceiptKind" NOT NULL,
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "cancels_receipt_id" UUID,
    "customer_name" TEXT NOT NULL,
    "customer_tax_id" TEXT,
    "label" TEXT NOT NULL,
    "amount_excl_tax" BIGINT NOT NULL,
    "vat_rate_bp" INTEGER NOT NULL,
    "vat_amount" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_receipts_pkey" PRIMARY KEY ("id"),
    -- A number looks like R-2026-000123 (C-54).
    CONSTRAINT "subscription_receipts_number_format" CHECK ("number" ~ '^R-[0-9]{4}-[0-9]{6}$'),
    -- The total is the amount excluding tax plus the VAT (C-54).
    CONSTRAINT "subscription_receipts_amount_is_sum"
        CHECK ("amount" = "amount_excl_tax" + "vat_amount"),
    -- The total is above zero, the other amounts are not negative (C-54).
    CONSTRAINT "subscription_receipts_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "subscription_receipts_amounts_not_negative"
        CHECK ("amount_excl_tax" >= 0 AND "vat_amount" >= 0 AND "vat_rate_bp" >= 0),
    -- A cancelled receipt is named exactly when the row is a credit note (C-54).
    CONSTRAINT "subscription_receipts_cancels_matches_kind"
        CHECK (("cancels_receipt_id" IS NOT NULL) = ("kind" = 'CREDIT_NOTE'))
);

-- CreateIndex
-- At most one credit note per receipt (C-54).
CREATE UNIQUE INDEX "subscription_receipts_number_key" ON "subscription_receipts"("number");
CREATE UNIQUE INDEX "subscription_receipts_cancels_receipt_id_key"
    ON "subscription_receipts"("cancels_receipt_id");
CREATE INDEX "subscription_receipts_organization_id_issued_at_idx"
    ON "subscription_receipts"("organization_id", "issued_at");
CREATE INDEX "subscription_receipts_payment_id_idx" ON "subscription_receipts"("payment_id");

-- AddForeignKey
ALTER TABLE "subscription_receipts"
    ADD CONSTRAINT "subscription_receipts_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_receipts"
    ADD CONSTRAINT "subscription_receipts_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_receipts"
    ADD CONSTRAINT "subscription_receipts_cancels_receipt_id_fkey"
    FOREIGN KEY ("cancels_receipt_id") REFERENCES "subscription_receipts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Next receipt number: R-<issue year>-<last suffix + 1 on 6 digits>, one series
-- across years (C-54). The transaction-level advisory lock makes concurrent
-- writers queue until the one holding it commits, so no number is skipped or
-- given twice; a PostgreSQL sequence is not used because it can skip numbers.
-- The year is the UTC year of the issue time.
CREATE FUNCTION next_subscription_receipt_number(issued timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  last_suffix integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('subscription_receipt_number', 0));
  SELECT max(right(r."number", 6)::integer) INTO last_suffix
  FROM public.subscription_receipts r;
  last_suffix := COALESCE(last_suffix, 0) + 1;
  IF last_suffix > 999999 THEN
    RAISE EXCEPTION 'subscription receipt numbers are exhausted' USING ERRCODE = '23514';
  END IF;
  RETURN 'R-' || to_char(issued AT TIME ZONE 'UTC', 'YYYY') || '-' || lpad(last_suffix::text, 6, '0');
END;
$$;

-- Only the number the function returns is accepted, so numbers have no gap
-- (C-54). The same lock is taken first, so the check and the insert cannot
-- interleave with another writer.
CREATE FUNCTION subscription_receipts_check_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- A missing number is left to the NOT NULL rule.
  IF NEW."number" IS NOT NULL
     AND NEW."number" IS DISTINCT FROM public.next_subscription_receipt_number(NEW."issued_at") THEN
    RAISE EXCEPTION 'a subscription receipt number must be the next one in the series'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "subscription_receipts_check_number"
BEFORE INSERT ON "subscription_receipts"
FOR EACH ROW EXECUTE FUNCTION subscription_receipts_check_number();

-- A credit note cancels a RECEIPT of the same business, for the same payment
-- and with the same amounts (C-54).
CREATE FUNCTION subscription_receipts_check_credit_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."cancels_receipt_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.subscription_receipts r
    WHERE r."id" = NEW."cancels_receipt_id"
      AND r."kind" = 'RECEIPT'
      AND r."organization_id" = NEW."organization_id"
      AND r."payment_id" = NEW."payment_id"
      AND r."amount_excl_tax" = NEW."amount_excl_tax"
      AND r."vat_amount" = NEW."vat_amount"
      AND r."amount" = NEW."amount"
  ) THEN
    RAISE EXCEPTION 'a credit note must cancel a receipt of the same business, payment and amounts'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "subscription_receipts_check_credit_note"
BEFORE INSERT ON "subscription_receipts"
FOR EACH ROW EXECUTE FUNCTION subscription_receipts_check_credit_note();

-- The journal is append-only for the application account: SELECT and INSERT
-- only, and EXECUTE on the number function (C-39, C-54).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "subscription_receipts" FROM distribo_app;
REVOKE EXECUTE ON FUNCTION next_subscription_receipt_number(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_subscription_receipt_number(timestamptz) TO distribo_app;
