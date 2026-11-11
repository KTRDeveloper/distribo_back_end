-- SYNC-046: a delivery pushed from a phone that was offline wins over the customer's change. The
-- replaced version (cancelled, deleted, linked to its replacement) is restored by clearing
-- deleted_at, then delivered. The status rules freeze a CANCELLED order, so this one change is
-- allowed: deleted_at may go from set to empty on an order that carries replaced_by_order_id.
-- Everything else stays frozen, and the link itself never changes.
CREATE OR REPLACE FUNCTION orders_enforce_status_rules()
RETURNS trigger AS $$
DECLARE
    unfrozen text[] := ARRAY['supplier_note', 'sync_issue', 'server_updated_at'];
BEGIN
    IF NEW."status" = OLD."status" THEN
        IF OLD."deleted_at" IS NOT NULL AND NEW."deleted_at" IS NULL
           AND OLD."replaced_by_order_id" IS NOT NULL THEN
            unfrozen := array_append(unfrozen, 'deleted_at');
        END IF;
        IF OLD."status" IN ('DELIVERED', 'CANCELLED')
           AND (to_jsonb(NEW) - unfrozen) IS DISTINCT FROM (to_jsonb(OLD) - unfrozen) THEN
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
