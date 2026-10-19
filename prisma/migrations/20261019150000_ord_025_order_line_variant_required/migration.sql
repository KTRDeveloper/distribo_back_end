-- ORD-025: every order line names the variant that was sold. The lines saved before
-- ORD-024 get the variant that has the id of their product (CAT-013), then the
-- column becomes required. The insert trigger of ORD-024 keeps filling it for old
-- code that writes product_id only.
--
-- The test replays the lines between the markers, so keep comments inside them
-- free of semicolons.

-- audit start
-- Stop on a line that has no variant and no variant of its product: there is no
-- source for another value and none is invented (v5.0.0-2.2.3). The message lists
-- line ids only, at most 20, never a label, a name or an amount.
DO $audit$
DECLARE
    orphan_count integer;
    orphan_ids text;
BEGIN
    SELECT count(*) INTO orphan_count
    FROM "order_lines" l
    WHERE l."product_variant_id" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "product_variants" v WHERE v."id" = l."product_id");

    IF orphan_count > 0 THEN
        SELECT string_agg(o."id"::text, ', ' ORDER BY o."id") INTO orphan_ids
        FROM (
            SELECT l."id"
            FROM "order_lines" l
            WHERE l."product_variant_id" IS NULL
              AND NOT EXISTS (SELECT 1 FROM "product_variants" v WHERE v."id" = l."product_id")
            ORDER BY l."id"
            LIMIT 20
        ) o;
        RAISE EXCEPTION 'ORD-025: % order line(s) have no variant and no variant of their product, first ids: %',
            orphan_count, orphan_ids
            USING ERRCODE = '23514';
    END IF;
END
$audit$;
-- audit end

-- copy start
-- The variant of an old line is the variant that has the id of its product. The
-- trigger on the table moves server_updated_at, so phones fetch these lines again
-- (C-35). A second run finds no empty variant and changes nothing.
UPDATE "order_lines"
SET "product_variant_id" = "product_id"
WHERE "product_variant_id" IS NULL;
-- copy end

ALTER TABLE "order_lines" ALTER COLUMN "product_variant_id" SET NOT NULL;
