-- CreateEnum
CREATE TYPE "OrderParty" AS ENUM ('CUSTOMER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "customer_relationship_id" UUID NOT NULL,
    "placed_by_party" "OrderParty" NOT NULL,
    "entered_by_id" UUID NOT NULL,
    "delivery_address_applied" TEXT,
    "total_amount" BIGINT NOT NULL,
    "delivery_cost" BIGINT NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "delivered_at" TIMESTAMPTZ,
    "delivered_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desired_delivery_date" DATE,
    "cancelled_by_party" "OrderParty",
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "cancellation_reason" TEXT,
    "parent_order_id" UUID,
    "customer_note" TEXT,
    "supplier_note" TEXT,
    "sync_issue" TEXT,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_customer_relationship_id_idx" ON "orders"("customer_relationship_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_delivered_by_id_delivered_at_idx" ON "orders"("delivered_by_id", "delivered_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_relationship_id_fkey" FOREIGN KEY ("customer_relationship_id") REFERENCES "customer_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_entered_by_id_fkey" FOREIGN KEY ("entered_by_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivered_by_id_fkey" FOREIGN KEY ("delivered_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_parent_order_id_fkey" FOREIGN KEY ("parent_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The people who entered, delivered and cancelled an order must be registered
-- people. Checked at commit, like the other author columns (C-04).
CREATE CONSTRAINT TRIGGER "orders_require_registered_person"
AFTER INSERT OR UPDATE ON "orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('entered_by_id', 'delivered_by_id', 'cancelled_by_id');

CREATE TRIGGER "orders_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
