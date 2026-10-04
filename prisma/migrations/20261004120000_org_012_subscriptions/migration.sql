CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED');

CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id")
        REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- At most one ACTIVE subscription per organization; EXPIRED rows are history
-- (C-31, v5.0.0-2.2.3).
CREATE UNIQUE INDEX "subscriptions_one_active_key"
    ON "subscriptions"("organization_id")
    WHERE "status" = 'ACTIVE';
