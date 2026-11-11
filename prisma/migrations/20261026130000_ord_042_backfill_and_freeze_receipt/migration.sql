-- ORD-042: delivered orders get their receipt from the server's history, then
-- every receipt is frozen (C-62, v5.0.0-2.2.1). One migration, in order.

-- 1. Audit: a DELIVERED order must have a SALE entry (one that is not a
-- reversal). Otherwise the migration stops and nothing is applied.
DO $$
DECLARE
    v_ids text;
BEGIN
    SELECT string_agg(o."id"::text, ', ' ORDER BY o."id") INTO v_ids
      FROM "orders" o
     WHERE o."status" = 'DELIVERED'
       AND NOT EXISTS (
           SELECT 1 FROM "ledger_entries" s
            WHERE s."order_id" = o."id"
              AND s."kind" = 'SALE'
              AND s."reverses_entry_id" IS NULL
       );
    IF v_ids IS NOT NULL THEN
        RAISE EXCEPTION 'ORD-042: DELIVERED orders without a SALE entry: %', v_ids;
    END IF;
END;
$$;

-- 2. Backfill. The status rules freeze a DELIVERED order, so that trigger is
-- switched off for this one statement only (the same migration switches it on again).
ALTER TABLE "orders" DISABLE TRIGGER "orders_enforce_status_rules";

-- The first SALE of each order marks the delivery: one transaction stamps the
-- SALE and its PAYMENT with the same server_updated_at, later entries are newer.
WITH first_sale AS (
    SELECT DISTINCT ON (s."order_id") s."order_id", s."server_updated_at" AS "at"
      FROM "ledger_entries" s
      JOIN "orders" o ON o."id" = s."order_id"
     WHERE o."status" = 'DELIVERED'
       AND o."supplier_name_applied" IS NULL
       AND s."kind" = 'SALE'
       AND s."reverses_entry_id" IS NULL
     ORDER BY s."order_id", s."server_updated_at", s."id"
)
UPDATE "orders" o
   SET "supplier_name_applied" = supplier."name",
       -- The customer's public name only: never customer_label, and nothing
       -- for an anonymized person or a customer without an account.
       "customer_name_applied" = CASE
           WHEN customer_org."id" IS NOT NULL THEN customer_org."name"
           WHEN customer_person."status" <> 'ANONYMIZED' THEN customer_person."full_name"
       END,
       "collected_applied" = COALESCE((
           SELECT sum(p."amount") FROM "ledger_entries" p
            WHERE p."order_id" = o."id" AND p."kind" = 'PAYMENT'
              AND p."server_updated_at" = first_sale."at"
       ), 0),
       "balance_after_applied" = COALESCE((
           SELECT sum(e."balance_effect") FROM "ledger_entries" e
            WHERE e."customer_relationship_id" = o."customer_relationship_id"
              AND e."server_updated_at" <= first_sale."at"
       ), 0)
  FROM first_sale
  JOIN "customer_relationships" r ON TRUE
  JOIN "organizations" supplier ON supplier."id" = r."supplier_organization_id"
  LEFT JOIN "organizations" customer_org ON customer_org."id" = r."customer_organization_id"
  LEFT JOIN "people" customer_person ON customer_person."id" = r."customer_person_id"
 WHERE first_sale."order_id" = o."id"
   AND r."id" = o."customer_relationship_id";

-- Deferred checks of the updated rows run now: a table with pending trigger
-- events cannot be altered.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "orders" ENABLE TRIGGER "orders_enforce_status_rules";

-- 3. Freeze: once supplier_name_applied is set, none of the four receipt
-- fields changes any more, even for code that bypasses the application.
CREATE OR REPLACE FUNCTION orders_freeze_receipt()
RETURNS trigger AS $$
BEGIN
    IF OLD."supplier_name_applied" IS NOT NULL
       AND (NEW."supplier_name_applied" IS DISTINCT FROM OLD."supplier_name_applied"
            OR NEW."customer_name_applied" IS DISTINCT FROM OLD."customer_name_applied"
            OR NEW."collected_applied" IS DISTINCT FROM OLD."collected_applied"
            OR NEW."balance_after_applied" IS DISTINCT FROM OLD."balance_after_applied") THEN
        RAISE EXCEPTION 'the receipt of an order cannot change once it is set'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_freeze_receipt"
BEFORE UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION orders_freeze_receipt();
