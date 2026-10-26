-- CAT-041: products lose their old price, unit, minimum and status. The variants
-- carry them now, so a price lives in one place only.

-- The test replays the lines between the two markers as one statement, so keep
-- the guard a single DO block.
-- guard start
DO $$
BEGIN
    -- v5.0.0-2.2.1: refuse to run on data the drop would lose. A live product
    -- without a live variant has its price only in the column about to go.
    IF EXISTS (
        SELECT 1
        FROM "products" p
        WHERE p."deleted_at" IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "product_variants" v
              WHERE v."product_id" = p."id" AND v."deleted_at" IS NULL
          )
    ) THEN
        RAISE EXCEPTION 'CAT-041: a product not deleted has no variant not deleted, its price would be lost';
    END IF;
END
$$;
-- guard end

-- The two mirror triggers of CAT-014 and their functions.
DROP TRIGGER "products_mirror_insert_to_variant" ON "products";
DROP TRIGGER "products_mirror_update_to_variant" ON "products";
DROP FUNCTION mirror_product_insert_to_variant();
DROP FUNCTION mirror_product_update_to_variant();

-- The price date trigger of CAT-001. The function stays: the variants use it.
DROP TRIGGER "products_set_price_updated_at" ON "products";

-- CHECKs of CAT-001.
ALTER TABLE "products" DROP CONSTRAINT "products_price_positive";
ALTER TABLE "products" DROP CONSTRAINT "products_min_order_quantity_positive";

-- AlterTable
ALTER TABLE "products"
    DROP COLUMN "unit",
    DROP COLUMN "price",
    DROP COLUMN "price_updated_at",
    DROP COLUMN "min_order_quantity",
    DROP COLUMN "status";
