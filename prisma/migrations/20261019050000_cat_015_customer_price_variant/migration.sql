-- CAT-015: a negotiated price names a variant instead of a product, so one
-- customer can have a different price for each variant of a product.
-- product_id stays, required, until a later story drops it. The column below is
-- empty-allowed for now: a price of a product that has no variant yet keeps it
-- empty, and the trigger fills it as soon as the variant exists at insert time.

ALTER TABLE "customer_prices" ADD COLUMN "product_variant_id" UUID;

CREATE INDEX "customer_prices_product_variant_id_idx" ON "customer_prices"("product_variant_id");

ALTER TABLE "customer_prices"
    ADD CONSTRAINT "customer_prices_product_variant_id_fkey"
    FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The test replays the lines between the two markers, so keep them free of
-- semicolons in comments and keep one statement per semicolon.
-- copy start
-- CAT-013 gave each product a variant with the id of the product, so the
-- variant of a price is found with the product id it already holds. A price
-- whose product has no variant stays empty. server_updated_at is moved by its
-- trigger to the time of the copy (C-35).
UPDATE "customer_prices" cp
SET "product_variant_id" = cp."product_id"
WHERE cp."product_variant_id" IS NULL
  AND EXISTS (SELECT 1 FROM "product_variants" v WHERE v."id" = cp."product_id");
-- copy end

-- One live price per relationship and variant; deleted rows do not count
-- (C-11, C-35, v5.0.0-8.2.2). It replaces the index on the product: two
-- variants of one product may each carry a price for the same customer.
DROP INDEX "customer_prices_live_relationship_product_key";

CREATE UNIQUE INDEX "customer_prices_live_relationship_variant_key"
    ON "customer_prices"("customer_relationship_id", "product_variant_id")
    WHERE "deleted_at" IS NULL;

-- Old code and tests insert a price with product_id only: the variant that has
-- the id of the product completes the row. When no such variant exists the
-- column stays empty. Named so that it runs before the other triggers.
CREATE FUNCTION customer_prices_fill_variant() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW."product_variant_id" IS NULL
       AND EXISTS (SELECT 1 FROM "product_variants" WHERE "id" = NEW."product_id") THEN
        NEW."product_variant_id" := NEW."product_id";
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "customer_prices_fill_variant"
BEFORE INSERT ON "customer_prices"
FOR EACH ROW EXECUTE FUNCTION customer_prices_fill_variant();

-- The variant must belong to the supplier organization of the relationship, as
-- the product must (CAT-002). A relationship supplied by a person has no
-- organization and is refused too (C-11, v5.0.0-2.2.3). An unknown relationship
-- or variant is left to the foreign keys, which answer 23503.
CREATE FUNCTION customer_prices_require_supplier_variant() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    relationship_found boolean;
    variant_found boolean;
    supplier_id uuid;
    variant_org_id uuid;
BEGIN
    IF NEW."product_variant_id" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT true, "supplier_organization_id" INTO relationship_found, supplier_id
    FROM "customer_relationships" WHERE "id" = NEW."customer_relationship_id";
    SELECT true, "organization_id" INTO variant_found, variant_org_id
    FROM "product_variants" WHERE "id" = NEW."product_variant_id";

    IF relationship_found IS TRUE AND variant_found IS TRUE
       AND (supplier_id IS NULL OR supplier_id IS DISTINCT FROM variant_org_id) THEN
        RAISE EXCEPTION 'customer price variant does not belong to the relationship supplier'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "customer_prices_require_supplier_variant"
BEFORE INSERT OR UPDATE OF "customer_relationship_id", "product_variant_id" ON "customer_prices"
FOR EACH ROW EXECUTE FUNCTION customer_prices_require_supplier_variant();
