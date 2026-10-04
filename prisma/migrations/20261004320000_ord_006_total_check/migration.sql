-- ORD-006: an order's total equals the sum of its lines plus the delivery cost,
-- and a DELIVERED order's lines all carry a delivered quantity (C-19,
-- v5.0.0-2.2.3, v5.0.0-2.3.3).
-- The check runs when the transaction commits, so lines and total can be
-- written in any order inside one transaction. An order with no (non-deleted)
-- line must have total_amount = delivery_cost.

CREATE FUNCTION orders_check_total_and_delivery(p_order_id uuid)
RETURNS void AS $$
DECLARE
    v_total bigint;
    v_cost bigint;
    v_status "OrderStatus";
    v_sum bigint;
    v_missing bigint;
BEGIN
    SELECT "total_amount", "delivery_cost", "status"
      INTO v_total, v_cost, v_status
      FROM "orders" WHERE "id" = p_order_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT coalesce(sum("amount"), 0),
           count(*) FILTER (WHERE "delivered_quantity" IS NULL)
      INTO v_sum, v_missing
      FROM "order_lines"
     WHERE "order_id" = p_order_id AND "deleted_at" IS NULL;

    IF v_total <> v_sum + v_cost THEN
        RAISE EXCEPTION 'order total must equal the sum of its lines plus the delivery cost'
            USING ERRCODE = '23514';
    END IF;
    IF v_status = 'DELIVERED' AND v_missing > 0 THEN
        RAISE EXCEPTION 'a DELIVERED order needs a delivered quantity on every line'
            USING ERRCODE = '23514';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger function shared by both tables: checks every order the row touched.
CREATE FUNCTION orders_check_total_trigger()
RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME = 'orders' THEN
        PERFORM orders_check_total_and_delivery(NEW."id");
        RETURN NULL;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM orders_check_total_and_delivery(NEW."order_id");
    END IF;
    IF TG_OP = 'DELETE'
       OR (TG_OP = 'UPDATE' AND OLD."order_id" IS DISTINCT FROM NEW."order_id") THEN
        PERFORM orders_check_total_and_delivery(OLD."order_id");
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "orders_check_total"
AFTER INSERT OR UPDATE ON "orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION orders_check_total_trigger();

CREATE CONSTRAINT TRIGGER "order_lines_check_order_total"
AFTER INSERT OR UPDATE OR DELETE ON "order_lines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION orders_check_total_trigger();
