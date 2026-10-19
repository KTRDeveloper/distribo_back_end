-- CreateEnum
CREATE TYPE "PaidPlan" AS ENUM ('ESSENTIAL', 'PRO', 'ENTERPRISE');
CREATE TYPE "PaymentOperator" AS ENUM ('MTN_MOMO', 'ORANGE_MONEY', 'OTHER');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED');

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan" "PaidPlan" NOT NULL,
    "months" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "operator" "PaymentOperator" NOT NULL,
    "payer_phone_number" TEXT,
    "provider_reference" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider_payload" JSONB,
    "terms_version" TEXT NOT NULL,
    "customer_tax_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id"),
    -- The amount is a positive sum of money (C-53).
    CONSTRAINT "subscription_payments_amount_positive" CHECK ("amount" > 0),
    -- Plans are prepaid for 1, 3, 6 or 12 months (C-53).
    CONSTRAINT "subscription_payments_months_allowed" CHECK ("months" IN (1, 3, 6, 12)),
    -- A confirmation date exists exactly when the payment succeeded or was refunded (C-53).
    CONSTRAINT "subscription_payments_confirmed_at_matches_status"
        CHECK (("confirmed_at" IS NOT NULL) = ("status" IN ('SUCCEEDED', 'REFUNDED'))),
    -- No payer number exactly when an administrator recorded the payment (C-53).
    CONSTRAINT "subscription_payments_payer_matches_operator"
        CHECK (("payer_phone_number" IS NULL) = ("operator" = 'OTHER')),
    -- A payer number, when given, is never blank.
    CONSTRAINT "subscription_payments_payer_not_blank"
        CHECK ("payer_phone_number" IS NULL OR btrim("payer_phone_number") <> '')
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_provider_reference_key"
    ON "subscription_payments"("provider_reference");
CREATE INDEX "subscription_payments_organization_id_created_at_idx"
    ON "subscription_payments"("organization_id", "created_at");
CREATE INDEX "subscription_payments_status_created_at_idx"
    ON "subscription_payments"("status", "created_at");

-- AddForeignKey
ALTER TABLE "subscription_payments"
    ADD CONSTRAINT "subscription_payments_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payment only moves forward and its money fields never change (C-53).
-- Allowed: PENDING to any other status, SUCCEEDED to REFUNDED. Of the columns,
-- only status, provider_payload and confirmed_at may change.
CREATE FUNCTION subscription_payments_check_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       OLD.status = 'PENDING'
       OR (OLD.status = 'SUCCEEDED' AND NEW.status = 'REFUNDED')
     ) THEN
    RAISE EXCEPTION 'subscription payment status cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.months IS DISTINCT FROM OLD.months
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.operator IS DISTINCT FROM OLD.operator
     OR NEW.payer_phone_number IS DISTINCT FROM OLD.payer_phone_number
     OR NEW.provider_reference IS DISTINCT FROM OLD.provider_reference
     OR NEW.terms_version IS DISTINCT FROM OLD.terms_version
     OR NEW.customer_tax_id IS DISTINCT FROM OLD.customer_tax_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only status, provider_payload and confirmed_at of a subscription payment may change'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "subscription_payments_check_update"
BEFORE UPDATE ON "subscription_payments"
FOR EACH ROW EXECUTE FUNCTION subscription_payments_check_update();

-- Payments are never deleted by the application; the purge (PRIV) uses the migration account.
REVOKE DELETE, TRUNCATE ON TABLE "subscription_payments" FROM distribo_app;
