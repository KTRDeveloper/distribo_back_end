-- CreateTable
-- The registry of photos copied from another photo (C-56). It names no
-- organization and no person: only keys under products/ (FND-013).
CREATE TABLE "image_copies" (
    "copy_key" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "root_key" TEXT NOT NULL,
    "copied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_copies_pkey" PRIMARY KEY ("copy_key"),
    -- Only product and variant photos are copied, never a logo or a profile photo.
    CONSTRAINT "image_copies_copy_key_under_products" CHECK ("copy_key" LIKE 'products/%'),
    CONSTRAINT "image_copies_source_key_under_products" CHECK ("source_key" LIKE 'products/%'),
    CONSTRAINT "image_copies_root_key_under_products" CHECK ("root_key" LIKE 'products/%'),
    -- A photo is never a copy of itself, nor the root of its own family.
    CONSTRAINT "image_copies_copy_differs_from_source" CHECK ("copy_key" <> "source_key"),
    CONSTRAINT "image_copies_copy_differs_from_root" CHECK ("copy_key" <> "root_key")
);

-- CreateIndex
CREATE INDEX "image_copies_root_key_idx" ON "image_copies"("root_key");
CREATE INDEX "image_copies_source_key_idx" ON "image_copies"("source_key");

-- The root of a family never changes: when the source is itself a copy, the new
-- row takes that copy's root; otherwise the source is the original and is the root.
-- A null key is left to the NOT NULL constraint, which reports it with 23502.
CREATE FUNCTION image_copies_check_root()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  expected_root text;
BEGIN
  IF NEW.source_key IS NULL OR NEW.root_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.root_key INTO expected_root
  FROM public.image_copies c
  WHERE c.copy_key = NEW.source_key;

  IF NOT FOUND THEN
    expected_root := NEW.source_key;
  END IF;

  IF NEW.root_key <> expected_root THEN
    RAISE EXCEPTION 'root_key must be the root of the source photo family'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "image_copies_check_root"
BEFORE INSERT OR UPDATE ON "image_copies"
FOR EACH ROW EXECUTE FUNCTION image_copies_check_root();

-- The registry only grows for the application account (C-39).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "image_copies" FROM distribo_app;
