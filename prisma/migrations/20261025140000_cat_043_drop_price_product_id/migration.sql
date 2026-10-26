-- CAT-043: negotiated prices lose their product column. A price names a variant
-- only, so it points at one thing.

-- The test replays the lines between the two markers as one statement, so keep
-- the guard a single DO block.
-- guard start
DO $$
BEGIN
    -- v5.0.0-2.2.1: refuse to run on data the drop would lose. A price with no
    -- variant knows its product only through the column about to go.
    IF EXISTS (
        SELECT 1
        FROM "customer_prices"
        WHERE "product_variant_id" IS NULL
    ) THEN
        RAISE EXCEPTION 'CAT-043: a customer price has no product_variant_id, its product would be lost';
    END IF;
END
$$;
-- guard end

-- The variant is required now.
ALTER TABLE "customer_prices" ALTER COLUMN "product_variant_id" SET NOT NULL;

-- The trigger of CAT-015 that filled the variant from the product, and its function.
DROP TRIGGER "customer_prices_fill_variant" ON "customer_prices";
DROP FUNCTION customer_prices_fill_variant();

-- The trigger of CAT-002 that checked the product against the supplier, and its function.
-- The trigger on the variant (CAT-015) stays and does the same check on the variant.
DROP TRIGGER "customer_prices_require_supplier_product" ON "customer_prices";
DROP FUNCTION customer_prices_require_supplier_product();

-- DropIndex
DROP INDEX "customer_prices_product_id_idx";

-- DropForeignKey
ALTER TABLE "customer_prices" DROP CONSTRAINT "customer_prices_product_id_fkey";

-- AlterTable
ALTER TABLE "customer_prices" DROP COLUMN "product_id";
