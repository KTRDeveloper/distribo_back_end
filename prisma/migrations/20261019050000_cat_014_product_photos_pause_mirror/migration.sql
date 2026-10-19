-- CAT-014: products carry their photos and a pause date, and writes made the old
-- way (unit, price, minimum, status on the product) keep reaching the variants.

-- A row written the new way needs neither unit nor price: an empty unit marks it
-- new-style, and its old columns are never read.
ALTER TABLE "products" ALTER COLUMN "unit" SET DEFAULT '';
ALTER TABLE "products" ALTER COLUMN "price" SET DEFAULT 1;

-- AlterTable
-- paused_at is written by the server only (C-46).
ALTER TABLE "products"
    ADD COLUMN "image_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "paused_at" TIMESTAMPTZ;

-- At most 5 photos per product (C-49, v5.0.0-2.2.1).
ALTER TABLE "products"
    ADD CONSTRAINT "products_image_keys_max_5" CHECK (cardinality("image_keys") <= 5);

-- CreateIndex
CREATE INDEX "products_image_keys_idx" ON "products" USING GIN ("image_keys");

-- Old-style insert: an empty unit is never copied, the code inserts the variants of
-- a new-style product itself. The variant takes the id of its product.
CREATE FUNCTION mirror_product_insert_to_variant() RETURNS trigger AS $$
BEGIN
    IF NEW."unit" <> '' THEN
        INSERT INTO "product_variants"
            ("id", "product_id", "organization_id", "name", "unit", "price",
             "price_updated_at", "min_order_quantity", "status")
        VALUES
            (NEW."id", NEW."id", NEW."organization_id", NULL, NEW."unit", NEW."price",
             NEW."price_updated_at", NEW."min_order_quantity", NEW."status");
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Old-style update: the five old columns are copied only when one of them changed,
-- so a rename leaves the variant (and its server_updated_at) alone.
CREATE FUNCTION mirror_product_update_to_variant() RETURNS trigger AS $$
BEGIN
    IF NEW."unit" <> ''
       AND (NEW."unit", NEW."price", NEW."price_updated_at", NEW."min_order_quantity", NEW."status")
           IS DISTINCT FROM
           (OLD."unit", OLD."price", OLD."price_updated_at", OLD."min_order_quantity", OLD."status")
    THEN
        UPDATE "product_variants"
        SET "unit" = NEW."unit",
            "price" = NEW."price",
            "price_updated_at" = NEW."price_updated_at",
            "min_order_quantity" = NEW."min_order_quantity",
            "status" = NEW."status"
        WHERE "id" = NEW."id";
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "products_mirror_insert_to_variant"
AFTER INSERT ON "products"
FOR EACH ROW EXECUTE FUNCTION mirror_product_insert_to_variant();

CREATE TRIGGER "products_mirror_update_to_variant"
AFTER UPDATE ON "products"
FOR EACH ROW EXECUTE FUNCTION mirror_product_update_to_variant();

-- The test replays the lines between the two markers, so keep them free of
-- semicolons in comments and keep one statement per semicolon.
-- touch start
-- Phones fetch every product again: server_updated_at moves to the migration time (C-35).
UPDATE "products" SET "server_updated_at" = now();
-- touch end
