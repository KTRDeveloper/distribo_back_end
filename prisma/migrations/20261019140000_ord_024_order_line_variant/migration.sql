-- ORD-024: an order line names a product variant, so orders can move from products
-- to variants without breaking the code that still writes products. product_id
-- stays, required. The column is empty-allowed until ORD-025 fills the lines that
-- already exist and makes it required.

ALTER TABLE "order_lines" ADD COLUMN "product_variant_id" UUID;

-- Also serves the per-variant sales and purchase totals read from delivered lines.
CREATE INDEX "order_lines_product_variant_id_idx" ON "order_lines"("product_variant_id");

ALTER TABLE "order_lines"
    ADD CONSTRAINT "order_lines_product_variant_id_fkey"
    FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Old code inserts a line with product_id only: the variant that has the id of the
-- product (CAT-013) completes the row. A new-style product has no variant of its
-- id, so the foreign key refuses the line (23503) and no variant is guessed. A
-- variant that is given is kept (ORD-026 checks it). Named so that it runs before
-- the other triggers on the table.
CREATE FUNCTION order_lines_fill_variant() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW."product_variant_id" IS NULL THEN
        NEW."product_variant_id" := NEW."product_id";
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "order_lines_a_fill_variant"
BEFORE INSERT ON "order_lines"
FOR EACH ROW EXECUTE FUNCTION order_lines_fill_variant();
