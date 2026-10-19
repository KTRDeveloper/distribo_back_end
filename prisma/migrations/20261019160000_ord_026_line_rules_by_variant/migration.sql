-- ORD-026: the order line rules read the variant and its product instead of the
-- product alone (C-15). On insert a line is accepted only for an ACTIVE, undeleted
-- variant of the supplier of the order's relationship, whose product is neither
-- deleted nor paused, and which is the variant of the line's own product. The line
-- names its variant (ORD-024 fills it from product_id when it is left out). An
-- old-style product keeps working: its variant mirrors its status and minimum
-- (CAT-014), and the deletion and the pause are read on the product itself.
-- The sync setting distribo.allow_retired_product ('on') still skips only the
-- status, deletion and pause checks (SYNC-012), never the business or product match
-- nor the minimum. An unknown variant is left to the foreign key (23503).
-- Nothing changes on update, and the customer price rules stay as they were.
CREATE OR REPLACE FUNCTION order_lines_enforce_rules()
RETURNS trigger AS $$
DECLARE
    order_party "OrderParty";
    rel_supplier_org uuid;
    line_variant_id uuid;
    variant_org uuid;
    variant_product uuid;
    variant_status "ProductStatus";
    variant_deleted_at timestamptz;
    variant_min_quantity numeric(12,3);
    product_deleted_at timestamptz;
    product_paused_at timestamptz;
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
        line_variant_id := coalesce(NEW."product_variant_id", NEW."product_id");

        SELECT "organization_id", "product_id", "status", "deleted_at", "min_order_quantity"
            INTO variant_org, variant_product, variant_status, variant_deleted_at,
                 variant_min_quantity
            FROM "product_variants"
            WHERE "id" = line_variant_id;

        IF FOUND THEN
            IF variant_product IS DISTINCT FROM NEW."product_id" THEN
                RAISE EXCEPTION 'an order line needs a variant of its own product'
                    USING ERRCODE = '23514';
            END IF;

            IF rel_supplier_org IS NULL OR variant_org IS DISTINCT FROM rel_supplier_org THEN
                RAISE EXCEPTION 'an order line needs a variant of the relationship supplier'
                    USING ERRCODE = '23514';
            END IF;

            SELECT "deleted_at", "paused_at"
                INTO product_deleted_at, product_paused_at
                FROM "products"
                WHERE "id" = variant_product;

            IF NOT allow_retired
               AND (variant_status IS DISTINCT FROM 'ACTIVE'
                    OR variant_deleted_at IS NOT NULL
                    OR product_deleted_at IS NOT NULL
                    OR product_paused_at IS NOT NULL) THEN
                RAISE EXCEPTION 'an order line needs an ACTIVE variant of a product on sale'
                    USING ERRCODE = '23514';
            END IF;

            IF order_party = 'CUSTOMER'
               AND variant_min_quantity IS NOT NULL
               AND NEW."quantity" < variant_min_quantity THEN
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
