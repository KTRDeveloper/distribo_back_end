-- ORG-020: logo key, payment code and plan fields on the organization, with the
-- rules that keep the plan fields consistent (C-41, C-49, v5.0.0-2.2.3).

CREATE TYPE "OrganizationPlan" AS ENUM ('FREE', 'ESSENTIAL', 'PRO', 'ENTERPRISE');

-- Business code of 8 characters from an alphabet without 0, 1, I and O. Each
-- character comes from one random byte of gen_random_uuid(). The alphabet has
-- 32 characters and 256 is a multiple of 32, so every character is equally
-- likely (no bias).
CREATE FUNCTION organization_payment_code()
RETURNS text AS $$
DECLARE
    alphabet CONSTANT text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    random_bytes bytea := uuid_send(gen_random_uuid());
    code text := '';
    i integer;
BEGIN
    FOR i IN 0..7 LOOP
        code := code || substr(alphabet, (get_byte(random_bytes, i) % 32) + 1, 1);
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql VOLATILE;

ALTER TABLE "organizations"
    ADD COLUMN "logo_key" TEXT,
    ADD COLUMN "payment_code" TEXT,
    ADD COLUMN "plan" "OrganizationPlan" NOT NULL DEFAULT 'FREE',
    ADD COLUMN "plan_ends_at" TIMESTAMPTZ,
    ADD COLUMN "grace_ends_at" TIMESTAMPTZ,
    ADD COLUMN "max_collaborators" INTEGER DEFAULT 2,
    ADD COLUMN "max_products" INTEGER DEFAULT 30;

-- Existing rows already hold FREE, no dates, 2 and 30 through the defaults.
-- They get their own code here, before the column becomes required. The
-- trigger on updates moves server_updated_at, which tells the phones about the
-- new fields.
UPDATE "organizations" SET "payment_code" = organization_payment_code();

ALTER TABLE "organizations"
    ALTER COLUMN "payment_code" SET DEFAULT organization_payment_code(),
    ALTER COLUMN "payment_code" SET NOT NULL;

-- Unique indexes ignore empty values, so any number of businesses may have no
-- logo.
CREATE UNIQUE INDEX "organizations_payment_code_key" ON "organizations"("payment_code");
CREATE UNIQUE INDEX "organizations_logo_key_key" ON "organizations"("logo_key");

-- A business is on the free plan exactly when it has no plan end date.
ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_plan_ends_at_check"
    CHECK (("plan" = 'FREE') = ("plan_ends_at" IS NULL));

-- A grace end date needs a plan end date and comes after it.
ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_grace_ends_at_check"
    CHECK ("grace_ends_at" IS NULL OR ("plan_ends_at" IS NOT NULL AND "grace_ends_at" > "plan_ends_at"));

-- An empty limit means no limit; a set limit is zero or more.
ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_max_collaborators_check" CHECK ("max_collaborators" >= 0),
    ADD CONSTRAINT "organizations_max_products_check" CHECK ("max_products" >= 0);
