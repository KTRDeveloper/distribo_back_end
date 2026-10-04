-- ORD-005: rules on order lines that read other tables (C-15, C-20, CM-16).
-- On insert the product must be an ACTIVE, undeleted product of the supplier
-- organization of the order's relationship (a person supplier has no products),
-- and a customer-placed order must reach the product's minimum quantity.
-- On an order placed by the CUSTOMER the applied price equals the reference
-- price on insert and is never above it afterwards (the supplier may only lower
-- it). Product and quantity are not re-checked on update, so a later product
-- change never blocks an old order.
-- Unknown orders or products are left to the foreign keys (23503).
CREATE FUNCTION order_lines_enforce_rules()
RETURNS trigger AS $$
DECLARE
    order_party "OrderParty";
    rel_supplier_org uuid;
    product_org uuid;
    product_status "ProductStatus";
    product_deleted_at timestamptz;
    product_min_quantity numeric(12,3);
BEGIN
    SELECT o."placed_by_party", r."supplier_organization_id"
        INTO order_party, rel_supplier_org
        FROM "orders" o
        JOIN "customer_relationships" r ON r."id" = o."customer_relationship_id"
        WHERE o."id" = NEW."order_id";

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT "organization_id", "status", "deleted_at", "min_order_quantity"
            INTO product_org, product_status, product_deleted_at, product_min_quantity
            FROM "products"
            WHERE "id" = NEW."product_id";

        IF FOUND THEN
            IF rel_supplier_org IS NULL OR product_org IS DISTINCT FROM rel_supplier_org THEN
                RAISE EXCEPTION 'an order line needs a product of the relationship supplier'
                    USING ERRCODE = '23514';
            END IF;

            IF product_status IS DISTINCT FROM 'ACTIVE' OR product_deleted_at IS NOT NULL THEN
                RAISE EXCEPTION 'an order line needs an ACTIVE product'
                    USING ERRCODE = '23514';
            END IF;

            IF order_party = 'CUSTOMER'
               AND product_min_quantity IS NOT NULL
               AND NEW."quantity" < product_min_quantity THEN
                RAISE EXCEPTION 'the quantity is below the minimum order quantity'
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        IF order_party = 'CUSTOMER' AND NEW."unit_price_applied" <> NEW."reference_price" THEN
            RAISE EXCEPTION 'a customer order line starts at the reference price'
                USING ERRCODE = '23514';
        END IF;
    ELSIF order_party = 'CUSTOMER' AND NEW."unit_price_applied" > NEW."reference_price" THEN
        RAISE EXCEPTION 'a customer order line price is never raised above the reference price'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "order_lines_enforce_rules"
    BEFORE INSERT OR UPDATE ON "order_lines"
    FOR EACH ROW EXECUTE FUNCTION order_lines_enforce_rules();
