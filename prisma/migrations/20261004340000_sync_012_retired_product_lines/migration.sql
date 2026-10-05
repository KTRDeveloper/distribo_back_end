-- SYNC-012: an order entered offline may name a product that was retired since.
-- The ACTIVE-product check of order_lines_enforce_rules (ORD-005) is skipped when the
-- transaction-local setting distribo.allow_retired_product is 'on'. Only the sync push sets it,
-- around the insert of a line of a product that is INACTIVE or deleted now; it is local to the
-- transaction (set_config(..., true)), so it never outlives the push. The product must still
-- belong to the relationship's supplier, and the other rules are unchanged.
CREATE OR REPLACE FUNCTION order_lines_enforce_rules()
RETURNS trigger AS $$
DECLARE
    order_party "OrderParty";
    rel_supplier_org uuid;
    product_org uuid;
    product_status "ProductStatus";
    product_deleted_at timestamptz;
    product_min_quantity numeric(12,3);
    allow_retired boolean;
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
        allow_retired := coalesce(current_setting('distribo.allow_retired_product', true), '') = 'on';

        SELECT "organization_id", "status", "deleted_at", "min_order_quantity"
            INTO product_org, product_status, product_deleted_at, product_min_quantity
            FROM "products"
            WHERE "id" = NEW."product_id";

        IF FOUND THEN
            IF rel_supplier_org IS NULL OR product_org IS DISTINCT FROM rel_supplier_org THEN
                RAISE EXCEPTION 'an order line needs a product of the relationship supplier'
                    USING ERRCODE = '23514';
            END IF;

            IF NOT allow_retired
               AND (product_status IS DISTINCT FROM 'ACTIVE' OR product_deleted_at IS NOT NULL) THEN
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
