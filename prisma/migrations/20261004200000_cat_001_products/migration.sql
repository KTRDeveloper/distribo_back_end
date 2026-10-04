-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price" BIGINT NOT NULL,
    "price_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "min_order_quantity" DECIMAL(12,3),
    "description" TEXT,
    "category" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    -- A price is always a positive amount of XAF (C-13, v5.0.0-2.2.3).
    CONSTRAINT "products_price_positive" CHECK ("price" > 0),
    -- A minimum order quantity, when set, is positive. The value is rounded to
    -- 3 decimals before this check, so 0.0004 is rejected as 0 (C-13).
    CONSTRAINT "products_min_order_quantity_positive"
        CHECK ("min_order_quantity" IS NULL OR "min_order_quantity" > 0)
);

-- CreateIndex
CREATE INDEX "products_organization_id_idx" ON "products"("organization_id");

-- AddForeignKey
ALTER TABLE "products"
    ADD CONSTRAINT "products_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The server owns price_updated_at: it is set on insert and moves only when the
-- price really changes. A value sent by a client is overwritten (C-13).
CREATE FUNCTION set_product_price_updated_at() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW."price_updated_at" := now();
    ELSIF NEW."price" IS DISTINCT FROM OLD."price" THEN
        NEW."price_updated_at" := now();
    ELSE
        NEW."price_updated_at" := OLD."price_updated_at";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "products_set_price_updated_at"
BEFORE INSERT OR UPDATE ON "products"
FOR EACH ROW EXECUTE FUNCTION set_product_price_updated_at();

CREATE TRIGGER "products_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "products"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
