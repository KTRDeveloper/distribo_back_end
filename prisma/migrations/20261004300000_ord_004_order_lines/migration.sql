-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "label_applied" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "delivered_quantity" DECIMAL(12,3),
    "reference_price" BIGINT NOT NULL,
    "unit_price_applied" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "price_set_by_id" UUID,
    "price_set_at" TIMESTAMPTZ,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_lines_order_id_idx" ON "order_lines"("order_id");

-- CreateIndex
CREATE INDEX "order_lines_product_id_idx" ON "order_lines"("product_id");

-- AddForeignKey
ALTER TABLE "order_lines"
    ADD CONSTRAINT "order_lines_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_lines"
    ADD CONSTRAINT "order_lines_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_lines"
    ADD CONSTRAINT "order_lines_price_set_by_id_fkey"
    FOREIGN KEY ("price_set_by_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quantities and prices (C-20, v5.0.0-2.2.1).
ALTER TABLE "order_lines"
    ADD CONSTRAINT "order_lines_quantity_positive_check" CHECK ("quantity" > 0),
    ADD CONSTRAINT "order_lines_delivered_quantity_range_check"
        CHECK ("delivered_quantity" IS NULL
               OR ("delivered_quantity" >= 0 AND "delivered_quantity" <= "quantity")),
    ADD CONSTRAINT "order_lines_reference_price_check" CHECK ("reference_price" >= 0),
    ADD CONSTRAINT "order_lines_unit_price_applied_check" CHECK ("unit_price_applied" >= 0);

-- Amount = quantity in thousandths x applied price / 1000, half up, integer
-- arithmetic only; the delivered quantity replaces the ordered one when set
-- (C-20, CM-14).
ALTER TABLE "order_lines"
    ADD CONSTRAINT "order_lines_amount_check"
    CHECK ("amount" = (((coalesce("delivered_quantity", "quantity") * 1000)::bigint
                        * "unit_price_applied") + 500) / 1000);

-- A price gap needs its author and time, and only a price gap has them
-- (C-20, v5.0.0-2.2.3).
ALTER TABLE "order_lines"
    ADD CONSTRAINT "order_lines_price_gap_author_check"
    CHECK (("unit_price_applied" <> "reference_price")
           = ("price_set_by_id" IS NOT NULL AND "price_set_at" IS NOT NULL)
           AND ("price_set_by_id" IS NULL) = ("price_set_at" IS NULL));

-- The author of a price gap must be a registered person, checked at commit (C-04).
CREATE CONSTRAINT TRIGGER "order_lines_require_registered_price_author"
AFTER INSERT OR UPDATE ON "order_lines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('price_set_by_id');

CREATE TRIGGER "order_lines_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "order_lines"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
