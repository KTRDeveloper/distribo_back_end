-- ORD-036: an order says whether it is delivered or picked up (C-60).
-- Additive: existing orders keep an empty mode, so the check cannot fail on them.
CREATE TYPE "ReceptionMode" AS ENUM ('DELIVERY', 'PICKUP');

ALTER TABLE "orders" ADD COLUMN "reception_mode" "ReceptionMode";

-- A PICKUP order has no delivery address (v5.0.0-2.2.1, CWE-20).
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_pickup_no_address_check"
        CHECK ("reception_mode" IS DISTINCT FROM 'PICKUP' OR "delivery_address_applied" IS NULL);
