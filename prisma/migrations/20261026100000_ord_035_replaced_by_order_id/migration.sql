-- ORD-035: an order a customer changed points at the version that replaced it (C-58).
-- Additive: existing orders keep an empty link, so no constraint can fail on them.
ALTER TABLE "orders" ADD COLUMN "replaced_by_order_id" UUID;

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_replaced_by_order_id_fkey"
        FOREIGN KEY ("replaced_by_order_id") REFERENCES "orders"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    -- An order is never replaced by itself.
    ADD CONSTRAINT "orders_replaced_by_not_self_check"
        CHECK ("replaced_by_order_id" IS NULL OR "replaced_by_order_id" <> "id"),
    -- Only an order placed by the CUSTOMER can carry a link.
    ADD CONSTRAINT "orders_replaced_by_customer_check"
        CHECK ("replaced_by_order_id" IS NULL OR "placed_by_party" = 'CUSTOMER');

-- Partial unique index: an order is the replacement of at most one order.
CREATE UNIQUE INDEX "orders_replaced_by_order_id_key"
    ON "orders" ("replaced_by_order_id")
    WHERE "replaced_by_order_id" IS NOT NULL;

-- The replacement must belong to the same relationship (v5.0.0-2.2.1, CWE-639).
CREATE FUNCTION orders_enforce_replaced_by_same_relationship()
RETURNS trigger AS $$
DECLARE
    target_relationship uuid;
BEGIN
    IF NEW."replaced_by_order_id" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT "customer_relationship_id" INTO target_relationship
        FROM "orders" WHERE "id" = NEW."replaced_by_order_id";

    -- An unknown target is left to the foreign key (23503), which refuses it.
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF target_relationship IS DISTINCT FROM NEW."customer_relationship_id" THEN
        RAISE EXCEPTION 'an order can only be replaced by an order of the same relationship'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_replaced_by_same_relationship"
    BEFORE INSERT OR UPDATE OF "replaced_by_order_id" ON "orders"
    FOR EACH ROW EXECUTE FUNCTION orders_enforce_replaced_by_same_relationship();
