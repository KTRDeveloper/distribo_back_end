-- CAT-018: two live variants of one product never share a name and a unit, and a
-- merged variant is always deleted (C-47, C-35).

-- Simplified text: capitals and extra spaces are ignored, an empty name equals the
-- empty text, nothing else is guessed. Unique among live variants only, so a deleted
-- variant frees its name and unit. The database refuses a second live row even for
-- two writes made at the same time (v5.0.0-2.2.1).
CREATE UNIQUE INDEX "product_variants_live_name_unit_key"
    ON "product_variants" (
        "product_id",
        lower(btrim(regexp_replace(coalesce("name", ''), '[ \t\r\n]+', ' ', 'g'))),
        lower(btrim(regexp_replace(coalesce("unit", ''), '[ \t\r\n]+', ' ', 'g')))
    )
    WHERE "deleted_at" IS NULL;

-- A merged variant points at the one that replaced it, so it must be deleted.
ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_merged_is_deleted"
    CHECK ("merged_into_id" IS NULL OR "deleted_at" IS NOT NULL);
