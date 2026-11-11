-- ORD-045: the receipt goes with the DELIVERED status (C-61, v5.0.0-2.2.1).
-- One migration, in order: an audit, then the CHECK.

-- 1. Audit: list every order that breaks the rule. If there is one, the migration
-- stops and nothing is applied.
DO $$
DECLARE
    v_ids text;
BEGIN
    SELECT string_agg(o."id"::text, ', ' ORDER BY o."id") INTO v_ids
      FROM "orders" o
     WHERE NOT (
         (o."status" = 'DELIVERED'
          AND o."supplier_name_applied" IS NOT NULL
          AND o."collected_applied" IS NOT NULL
          AND o."balance_after_applied" IS NOT NULL)
         OR
         (o."status" <> 'DELIVERED'
          AND o."supplier_name_applied" IS NULL
          AND o."customer_name_applied" IS NULL
          AND o."collected_applied" IS NULL
          AND o."balance_after_applied" IS NULL)
     );
    IF v_ids IS NOT NULL THEN
        RAISE EXCEPTION 'ORD-045: orders whose receipt does not match their status: %', v_ids;
    END IF;
END;
$$;

-- 2. A DELIVERED order has supplier name, collected and balance after (the customer
-- name may stay empty); any other order has all four fields empty.
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_receipt_matches_status_check" CHECK (
        (
            "status" = 'DELIVERED'
            AND "supplier_name_applied" IS NOT NULL
            AND "collected_applied" IS NOT NULL
            AND "balance_after_applied" IS NOT NULL
        ) OR (
            "status" <> 'DELIVERED'
            AND "supplier_name_applied" IS NULL
            AND "customer_name_applied" IS NULL
            AND "collected_applied" IS NULL
            AND "balance_after_applied" IS NULL
        )
    );
