-- ORD-022: orders carry the date they were accepted (C-51).
-- Existing orders keep an empty date: nothing recorded when an old order was
-- accepted, so there is nothing to backfill and no constraint can fail on them.
ALTER TABLE "orders" ADD COLUMN "accepted_at" TIMESTAMPTZ;

ALTER TABLE "orders"
    -- Only an order the customer placed can have an acceptance date (C-51).
    ADD CONSTRAINT "orders_accepted_at_customer_check"
        CHECK ("accepted_at" IS NULL OR "placed_by_party" = 'CUSTOMER'),
    -- A PENDING order has not been accepted yet (C-51). The older PENDING check
    -- (orders_pending_placed_by_customer_check) stays: a merged migration is never edited.
    ADD CONSTRAINT "orders_pending_not_accepted_check"
        CHECK ("status" IS DISTINCT FROM 'PENDING' OR "accepted_at" IS NULL);
