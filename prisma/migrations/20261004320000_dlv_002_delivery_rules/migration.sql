-- DLV-002: delivery state rules (C-21).

-- A delivery ends either in arrival or in failure, never both.
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_outcome_exclusive_check"
    CHECK ("arrived_at" IS NULL OR "failed_at" IS NULL);

-- A failure reason is given exactly when the delivery failed. An empty string
-- counts as no reason.
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_failure_reason_check"
    CHECK (("failed_at" IS NOT NULL) = (NULLIF(btrim("failure_reason"), '') IS NOT NULL));

-- At most one delivery in progress (neither arrived nor failed) per order.
-- Deleted rows are ignored (C-35).
CREATE UNIQUE INDEX "deliveries_one_in_progress_per_order_key"
    ON "deliveries"("order_id")
    WHERE "arrived_at" IS NULL AND "failed_at" IS NULL AND "deleted_at" IS NULL;

-- The driver is an ACTIVE collaborator, of any role, of the supplier
-- organization of the order's relationship. Inserts only: a delivery already
-- written stays valid when the driver later leaves. An unknown order or
-- driver is left to the foreign keys (23503).
CREATE FUNCTION deliveries_enforce_driver_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    supplier_org uuid;
BEGIN
    SELECT r.supplier_organization_id INTO supplier_org
        FROM public.orders o
        JOIN public.customer_relationships r ON r.id = o.customer_relationship_id
        WHERE o.id = NEW.order_id;

    IF NOT FOUND
       OR NOT EXISTS (SELECT 1 FROM public.people WHERE id = NEW.assigned_to_id) THEN
        RETURN NEW;
    END IF;

    IF supplier_org IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.collaborations
        WHERE person_id = NEW.assigned_to_id
          AND organization_id = supplier_org
          AND status = 'ACTIVE'
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'a delivery needs an ACTIVE collaborator of the supplier as driver'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "deliveries_driver_membership"
    BEFORE INSERT ON "deliveries"
    FOR EACH ROW EXECUTE FUNCTION deliveries_enforce_driver_membership();
