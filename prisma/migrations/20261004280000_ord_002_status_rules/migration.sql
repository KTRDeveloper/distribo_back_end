-- ORD-002: order status, cancellation and delivery rules (C-16, C-17, C-18, C-19, CM-12).
-- No existing row is rewritten: the table holds no production data yet and
-- fixtures are brought in line by the tests of ORD-001 (see "Tests to update").

ALTER TABLE "orders"
    -- The cancelling party, the cancelling person and the cancellation time are
    -- all set when the order is CANCELLED and all empty otherwise (C-16).
    ADD CONSTRAINT "orders_cancelled_party_check"
        CHECK ((COALESCE("status" = 'CANCELLED', false)) = ("cancelled_by_party" IS NOT NULL)),
    ADD CONSTRAINT "orders_cancelled_by_check"
        CHECK ((COALESCE("status" = 'CANCELLED', false)) = ("cancelled_by_id" IS NOT NULL)),
    ADD CONSTRAINT "orders_cancelled_at_check"
        CHECK ((COALESCE("status" = 'CANCELLED', false)) = ("cancelled_at" IS NOT NULL)),
    -- A reason exists only on a cancelled order, and a supplier must give one (C-16).
    ADD CONSTRAINT "orders_cancellation_reason_check"
        CHECK (
            ("cancellation_reason" IS NULL OR COALESCE("status" = 'CANCELLED', false))
            AND ("cancelled_by_party" IS DISTINCT FROM 'SUPPLIER' OR "cancellation_reason" IS NOT NULL)
        ),
    -- A PENDING order is always the customer's own (C-17).
    ADD CONSTRAINT "orders_pending_placed_by_customer_check"
        CHECK ("status" IS DISTINCT FROM 'PENDING' OR "placed_by_party" = 'CUSTOMER'),
    -- Delivery time and delivering person are set exactly when DELIVERED (C-19).
    ADD CONSTRAINT "orders_delivered_at_check"
        CHECK ((COALESCE("status" = 'DELIVERED', false)) = ("delivered_at" IS NOT NULL)),
    ADD CONSTRAINT "orders_delivered_by_check"
        CHECK ((COALESCE("status" = 'DELIVERED', false)) = ("delivered_by_id" IS NOT NULL));

-- Only the permitted status steps are accepted, and a DELIVERED or CANCELLED
-- order is frozen except for its supplier note and sync issue (C-18, CM-12).
-- Runs before the row is written so the CHECKs above see the final values.
CREATE FUNCTION orders_enforce_status_rules()
RETURNS trigger AS $$
BEGIN
    IF NEW."status" = OLD."status" THEN
        IF OLD."status" IN ('DELIVERED', 'CANCELLED')
           AND (to_jsonb(NEW) - ARRAY['supplier_note', 'sync_issue', 'server_updated_at'])
               IS DISTINCT FROM
               (to_jsonb(OLD) - ARRAY['supplier_note', 'sync_issue', 'server_updated_at']) THEN
            RAISE EXCEPTION 'a % order can only change its supplier_note and sync_issue', OLD."status"
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF (OLD."status", NEW."status") IN (
        ('PENDING', 'CONFIRMED'),
        ('PENDING', 'CANCELLED'),
        ('CONFIRMED', 'IN_DELIVERY'),
        ('CONFIRMED', 'DELIVERED'),
        ('CONFIRMED', 'CANCELLED'),
        ('IN_DELIVERY', 'DELIVERED'),
        ('IN_DELIVERY', 'CONFIRMED')
    ) THEN
        RETURN NEW;
    END IF;

    -- Delivery wins over an earlier cancellation, but only when the sync issue
    -- is recorded in the same update. The cancellation is erased here so the
    -- caller cannot leave half of it behind.
    IF OLD."status" = 'CANCELLED' AND NEW."status" = 'DELIVERED' AND NEW."sync_issue" IS NOT NULL THEN
        NEW."cancelled_by_party" := NULL;
        NEW."cancelled_by_id" := NULL;
        NEW."cancelled_at" := NULL;
        NEW."cancellation_reason" := NULL;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'order status step % to % is not permitted', OLD."status", NEW."status"
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_enforce_status_rules"
BEFORE UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION orders_enforce_status_rules();
