-- Preflight: the old rows (plan text, no price, no payment) cannot become prepaid
-- periods and nothing is invented, so any row stops the migration (C-52).
-- The message carries the count and at most 20 ids, never anything else.
DO $$
DECLARE
  row_count bigint;
  sample_ids text;
BEGIN
  SELECT count(*) INTO row_count FROM subscriptions;

  IF row_count > 0 THEN
    SELECT string_agg(id::text, ',' ORDER BY id)
    INTO sample_ids
    FROM (SELECT id FROM subscriptions ORDER BY id LIMIT 20) AS sample;

    RAISE EXCEPTION '% subscription rows must be resolved before rebuilding the table: %',
      row_count, sample_ids;
  END IF;
END
$$;

-- Drop the old shape.
DROP TABLE "subscriptions";
DROP TYPE "SubscriptionStatus";

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED');
CREATE TYPE "SubscriptionOrigin" AS ENUM ('PAYMENT', 'CONVERSION', 'GIFT');
CREATE TYPE "SubscriptionEndReason" AS ENUM ('EXPIRED', 'UPGRADED', 'CLOSED', 'REFUNDED');

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan" "PaidPlan" NOT NULL,
    "months" INTEGER,
    "price" BIGINT NOT NULL,
    "origin" "SubscriptionOrigin" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "payment_id" UUID,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "end_reason" "SubscriptionEndReason",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    -- A period never ends before it starts (C-52).
    CONSTRAINT "subscriptions_dates_ordered" CHECK ("starts_at" <= "ends_at"),
    -- Plans are prepaid for 1, 3, 6 or 12 months (C-52).
    CONSTRAINT "subscriptions_months_allowed" CHECK ("months" IS NULL OR "months" IN (1, 3, 6, 12)),
    -- A payment and a number of months exist exactly when the period was bought (C-52).
    CONSTRAINT "subscriptions_payment_matches_origin"
        CHECK (("payment_id" IS NOT NULL AND "months" IS NOT NULL) = ("origin" = 'PAYMENT')
               AND ("payment_id" IS NULL) = ("months" IS NULL)),
    -- An end reason exists exactly when the period has ended (C-52).
    CONSTRAINT "subscriptions_end_reason_matches_status"
        CHECK (("end_reason" IS NOT NULL) = ("status" = 'ENDED')),
    -- Only a bought period has a price (C-52).
    CONSTRAINT "subscriptions_price_zero_unless_payment"
        CHECK ("origin" = 'PAYMENT' OR "price" = 0)
);

-- CreateIndex
-- One payment buys one period.
CREATE UNIQUE INDEX "subscriptions_payment_id_key" ON "subscriptions"("payment_id");
CREATE INDEX "subscriptions_organization_id_idx" ON "subscriptions"("organization_id");

-- At most one ACTIVE period per organization; SCHEDULED and ENDED rows can be many (C-52).
CREATE UNIQUE INDEX "subscriptions_one_active_key"
    ON "subscriptions"("organization_id")
    WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Periods are never deleted by the application (C-52); SELECT, INSERT and UPDATE stay.
REVOKE DELETE, TRUNCATE ON TABLE "subscriptions" FROM distribo_app;
