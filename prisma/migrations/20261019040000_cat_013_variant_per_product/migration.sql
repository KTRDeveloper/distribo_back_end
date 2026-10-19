-- CAT-013: every product already stored gets one variant that carries what it
-- sold (unit, price, minimum, status), so selling can move to the variant.
-- The variant takes the id of its product: order lines and negotiated prices,
-- which hold the product id today, find it with the id they already hold.
-- The test replays the lines between the two markers, so keep them free of
-- semicolons in comments and keep one statement per semicolon.

-- copy start
-- Keep the price date of the product: the price-date trigger would reset it.
ALTER TABLE "product_variants" DISABLE TRIGGER "product_variants_set_price_updated_at";

-- The business comes from the product row only (v5.0.0-2.2.3). A product that
-- already has a variant, under any id, is skipped, so a second run adds nothing.
-- server_updated_at is left to its trigger: it is the time of the copy (C-35).
INSERT INTO "product_variants"
    ("id", "product_id", "organization_id", "name", "unit", "price", "price_updated_at",
     "min_order_quantity", "status", "created_at", "deleted_at")
SELECT p."id", p."id", p."organization_id", NULL, p."unit", p."price", p."price_updated_at",
       p."min_order_quantity", p."status", p."created_at", p."deleted_at"
FROM "products" p
WHERE NOT EXISTS (
    SELECT 1 FROM "product_variants" v WHERE v."product_id" = p."id"
);

ALTER TABLE "product_variants" ENABLE TRIGGER "product_variants_set_price_updated_at";
-- copy end
