BEGIN;

-- ORD-034: an order line names a variant and nothing else. The variant decides the
-- product and the supplier; no trigger fills it any more, so a line saved without
-- one fails closed (23502).

-- The rules function no longer compares a given product with the variant's product.
-- Every other ORD-026 / ORD-032 refusal is kept, including the offline exception.
CREATE OR REPLACE FUNCTION public.order_lines_enforce_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    order_party "OrderParty";
    rel_supplier_org uuid;
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

        SELECT "organization_id", "product_id", "status", "deleted_at", "min_order_quantity"
            INTO variant_org, variant_product, variant_status, variant_deleted_at,
                 variant_min_quantity
            FROM "product_variants"
            WHERE "id" = NEW."product_variant_id";

        IF FOUND THEN
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
$function$;


DROP TRIGGER "order_lines_a_fill_variant" ON "order_lines";
DROP FUNCTION order_lines_fill_variant();

DROP INDEX "order_lines_product_id_idx";
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_product_id_fkey";
ALTER TABLE "order_lines" DROP COLUMN "product_id";

COMMIT;
