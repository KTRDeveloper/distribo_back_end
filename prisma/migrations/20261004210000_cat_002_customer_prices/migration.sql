-- CreateTable
CREATE TABLE "customer_prices" (
    "id" UUID NOT NULL,
    "customer_relationship_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "price" BIGINT NOT NULL,
    "set_by_id" UUID NOT NULL,
    "set_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "customer_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_prices_customer_relationship_id_idx" ON "customer_prices"("customer_relationship_id");

-- CreateIndex
CREATE INDEX "customer_prices_product_id_idx" ON "customer_prices"("product_id");

-- AddForeignKey
ALTER TABLE "customer_prices"
    ADD CONSTRAINT "customer_prices_customer_relationship_id_fkey"
    FOREIGN KEY ("customer_relationship_id") REFERENCES "customer_relationships"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_prices"
    ADD CONSTRAINT "customer_prices_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_prices"
    ADD CONSTRAINT "customer_prices_set_by_id_fkey"
    FOREIGN KEY ("set_by_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- One live price per relationship and product; deleted rows do not count
-- (C-11, C-35, v5.0.0-8.2.2).
CREATE UNIQUE INDEX "customer_prices_live_relationship_product_key"
    ON "customer_prices"("customer_relationship_id", "product_id")
    WHERE "deleted_at" IS NULL;

-- The product must belong to the supplier organization of the relationship.
-- A relationship supplied by a person has no organization, so it matches no
-- product and is refused too (C-11, v5.0.0-2.2.3). An unknown relationship or
-- product is left to the foreign keys, which answer 23503.
CREATE FUNCTION customer_prices_require_supplier_product() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    relationship_found boolean;
    product_found boolean;
    supplier_id uuid;
    product_org_id uuid;
BEGIN
    SELECT true, "supplier_organization_id" INTO relationship_found, supplier_id
    FROM "customer_relationships" WHERE "id" = NEW."customer_relationship_id";
    SELECT true, "organization_id" INTO product_found, product_org_id
    FROM "products" WHERE "id" = NEW."product_id";

    IF relationship_found IS TRUE AND product_found IS TRUE
       AND (supplier_id IS NULL OR supplier_id IS DISTINCT FROM product_org_id) THEN
        RAISE EXCEPTION 'customer price product does not belong to the relationship supplier'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "customer_prices_require_supplier_product"
BEFORE INSERT OR UPDATE OF "customer_relationship_id", "product_id" ON "customer_prices"
FOR EACH ROW EXECUTE FUNCTION customer_prices_require_supplier_product();

-- The author of a price must be a registered person. Checked at commit,
-- like the other author columns (C-04).
CREATE CONSTRAINT TRIGGER "customer_prices_require_registered_author"
AFTER INSERT OR UPDATE ON "customer_prices"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('set_by_id');

CREATE TRIGGER "customer_prices_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "customer_prices"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
