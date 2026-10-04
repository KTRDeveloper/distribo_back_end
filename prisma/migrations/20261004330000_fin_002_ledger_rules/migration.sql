-- FIN-002: sale and reversal rules on ledger_entries (C-24, C-25,
-- v5.0.0-2.3.3, v5.0.0-2.2.3).

-- A reversal points to at most one entry, and an entry is reversed at most once.
CREATE UNIQUE INDEX "ledger_entries_reverses_entry_id_key"
ON "ledger_entries"("reverses_entry_id")
WHERE "reverses_entry_id" IS NOT NULL;

-- Sale rule: a SALE that is not a reversal carries an order_id, its amount
-- equals the order's total_amount, and the order has no other live SALE (one
-- that no entry reverses). An unknown order is left to the foreign key (23503).
CREATE FUNCTION ledger_entries_check_sale()
RETURNS trigger AS $$
DECLARE
    v_total bigint;
BEGIN
    IF NEW."kind" <> 'SALE' OR NEW."reverses_entry_id" IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF NEW."order_id" IS NULL THEN
        RAISE EXCEPTION 'a SALE needs an order_id'
            USING ERRCODE = '23514';
    END IF;

    -- Serialises concurrent sales of the same order: the second waits for the
    -- first to commit, then sees its row.
    PERFORM pg_advisory_xact_lock(hashtextextended('ledger_sale:' || NEW."order_id"::text, 0));

    SELECT "total_amount" INTO v_total FROM "orders" WHERE "id" = NEW."order_id";
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF NEW."amount" <> v_total THEN
        RAISE EXCEPTION 'a SALE amount must equal the order total'
            USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "ledger_entries" s
         WHERE s."order_id" = NEW."order_id"
           AND s."kind" = 'SALE'
           AND s."reverses_entry_id" IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM "ledger_entries" r WHERE r."reverses_entry_id" = s."id"
           )
    ) THEN
        RAISE EXCEPTION 'the order already has a SALE that is not reversed'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_check_sale"
BEFORE INSERT ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION ledger_entries_check_sale();

-- Reversal rule: the target has the same relationship, kind and amount and is
-- not itself a reversal. An unknown target is left to the foreign key (23503);
-- a second reversal of one target is refused by the unique index (23505).
CREATE FUNCTION ledger_entries_check_reversal()
RETURNS trigger AS $$
DECLARE
    v_target "ledger_entries"%ROWTYPE;
BEGIN
    IF NEW."reverses_entry_id" IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW."reverses_entry_id" = NEW."id" THEN
        RAISE EXCEPTION 'an entry cannot reverse itself'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO v_target FROM "ledger_entries" WHERE "id" = NEW."reverses_entry_id";
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF v_target."customer_relationship_id" <> NEW."customer_relationship_id"
       OR v_target."kind" <> NEW."kind"
       OR v_target."amount" <> NEW."amount" THEN
        RAISE EXCEPTION 'a reversal must mirror its target relationship, kind and amount'
            USING ERRCODE = '23514';
    END IF;
    IF v_target."reverses_entry_id" IS NOT NULL THEN
        RAISE EXCEPTION 'a reversal cannot target another reversal'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_check_reversal"
BEFORE INSERT ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION ledger_entries_check_reversal();
