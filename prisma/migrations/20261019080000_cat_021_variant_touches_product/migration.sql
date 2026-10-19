-- CAT-021: a variant change also moves the server date of its product, so that a
-- phone pulling products by server_updated_at always receives a product together
-- with its variants (CM-42, C-35).

-- The product date is set by the database (the BEFORE trigger of products stamps it
-- with the current time on every update). Only the variant's own product is touched.
-- The CAT-014 mirror fires only when one of the five old product columns changed,
-- and this update changes none, so there is no loop.
CREATE FUNCTION touch_product_of_variant() RETURNS trigger AS $$
BEGIN
    UPDATE "products"
    SET "server_updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = NEW."product_id";
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- AFTER the write, in the same transaction: the variant and the product date
-- succeed or fail together (v5.0.0-2.3.3). Every update counts, deleted_at included.
CREATE TRIGGER "product_variants_touch_product"
AFTER INSERT OR UPDATE ON "product_variants"
FOR EACH ROW EXECUTE FUNCTION touch_product_of_variant();
