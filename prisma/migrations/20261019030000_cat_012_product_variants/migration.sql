-- CAT-012: the sold level of the catalog. A product carries one or more variants,
-- each with its own unit, price and photos.

-- Lets a variant refer to its product together with the business (C-45).
-- CreateIndex
CREATE UNIQUE INDEX "products_id_organization_id_key" ON "products"("id", "organization_id");

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT,
    "unit" TEXT NOT NULL,
    "price" BIGINT NOT NULL,
    "price_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "min_order_quantity" DECIMAL(12,3),
    "image_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "merged_into_id" UUID,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
    -- A price is always a positive amount of XAF (C-13, v5.0.0-2.2.3).
    CONSTRAINT "product_variants_price_positive" CHECK ("price" > 0),
    -- A minimum order quantity, when set, is positive. The value is rounded to
    -- 3 decimals before this check, so 0.0004 is rejected as 0 (C-13).
    CONSTRAINT "product_variants_min_order_quantity_positive"
        CHECK ("min_order_quantity" IS NULL OR "min_order_quantity" > 0),
    -- At most 5 photos per variant (C-49, v5.0.0-2.2.3).
    CONSTRAINT "product_variants_image_keys_max_5"
        CHECK (cardinality("image_keys") <= 5)
);

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");
CREATE INDEX "product_variants_organization_id_idx" ON "product_variants"("organization_id");
CREATE INDEX "product_variants_merged_into_id_idx" ON "product_variants"("merged_into_id");
CREATE INDEX "product_variants_image_keys_idx" ON "product_variants" USING GIN ("image_keys");

-- AddForeignKey
-- The business of a variant is that of its product: the pair must exist in
-- products (C-45, v5.0.0-2.2.3).
ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_product_id_organization_id_fkey"
    FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_merged_into_id_fkey"
    FOREIGN KEY ("merged_into_id") REFERENCES "product_variants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The server owns price_updated_at (C-13): the same function as for products
-- sets it on insert and moves it only when the price really changes.
CREATE TRIGGER "product_variants_set_price_updated_at"
BEFORE INSERT OR UPDATE ON "product_variants"
FOR EACH ROW EXECUTE FUNCTION set_product_price_updated_at();

-- The server owns server_updated_at (C-35).
CREATE TRIGGER "product_variants_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "product_variants"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
