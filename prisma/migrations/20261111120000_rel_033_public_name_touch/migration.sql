-- REL-033: a renamed party resends its relationships to phones (v5.0.0-15.3.1).
-- Phones show the other side's public name (SYNC-047), computed at each pull
-- from people.full_name and organizations.name. A phone pulls a relationship
-- again only when its server_updated_at moves, so a name change touches the
-- relationships of that party. The touch is an update that changes nothing:
-- the set_server_updated_at trigger of customer_relationships does the rest.
-- The script can be run again without harm (OR REPLACE, DROP IF EXISTS).

-- 1. A person's full_name changed (rename, anonymization).
CREATE OR REPLACE FUNCTION touch_relationships_of_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.customer_relationships
     SET server_updated_at = server_updated_at
   WHERE customer_person_id = NEW.id OR supplier_person_id = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "people_touch_relationships_on_rename" ON "people";
CREATE TRIGGER "people_touch_relationships_on_rename"
AFTER UPDATE OF "full_name" ON "people"
FOR EACH ROW
WHEN (OLD."full_name" IS DISTINCT FROM NEW."full_name")
EXECUTE FUNCTION touch_relationships_of_person();

-- 2. An organization's name changed.
CREATE OR REPLACE FUNCTION touch_relationships_of_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.customer_relationships
     SET server_updated_at = server_updated_at
   WHERE customer_organization_id = NEW.id OR supplier_organization_id = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "organizations_touch_relationships_on_rename" ON "organizations";
CREATE TRIGGER "organizations_touch_relationships_on_rename"
AFTER UPDATE OF "name" ON "organizations"
FOR EACH ROW
WHEN (OLD."name" IS DISTINCT FROM NEW."name")
EXECUTE FUNCTION touch_relationships_of_organization();

-- 3. Put into service: every existing relationship is touched once, so phones
-- receive the new public name fields.
UPDATE "customer_relationships" SET "server_updated_at" = "server_updated_at";
