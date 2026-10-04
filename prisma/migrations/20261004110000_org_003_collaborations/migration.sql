CREATE TYPE "CollaborationRole" AS ENUM ('OWNER', 'MANAGER', 'SELLER', 'DRIVER');
CREATE TYPE "CollaborationStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');

CREATE TABLE "collaborations" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "CollaborationRole" NOT NULL,
    "status" "CollaborationStatus" NOT NULL,
    "is_public_contact" BOOLEAN NOT NULL DEFAULT false,
    "invited_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ,
    "amount_held" BIGINT NOT NULL DEFAULT 0,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "collaborations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "collaborations_person_id_fkey" FOREIGN KEY ("person_id")
        REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "collaborations_organization_id_fkey" FOREIGN KEY ("organization_id")
        REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Unique constraints ignore deleted rows (C-35).
CREATE UNIQUE INDEX "collaborations_person_id_organization_id_key"
    ON "collaborations"("person_id", "organization_id")
    WHERE "deleted_at" IS NULL;

-- At most one ACTIVE OWNER per organization at every statement (C-05, CM-09).
CREATE UNIQUE INDEX "collaborations_one_active_owner_key"
    ON "collaborations"("organization_id")
    WHERE "role" = 'OWNER' AND "status" = 'ACTIVE' AND "deleted_at" IS NULL;

CREATE TRIGGER "collaborations_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "collaborations"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();

-- Related columns are checked together: an ACTIVE collaboration needs a
-- registered person; a public contact needs ACTIVE status and a phone number.
CREATE FUNCTION collaborations_check_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND NEW.person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.people
    WHERE id = NEW.person_id AND registered_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'an ACTIVE collaboration needs a registered person'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.is_public_contact AND NEW.person_id IS NOT NULL AND (
    NEW.status <> 'ACTIVE'
    OR NOT EXISTS (
      SELECT 1 FROM public.people
      WHERE id = NEW.person_id AND phone_number IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'a public contact needs ACTIVE status and a person with an active number'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "collaborations_check_row"
BEFORE INSERT OR UPDATE ON "collaborations"
FOR EACH ROW EXECUTE FUNCTION collaborations_check_row();

-- When a transaction ends, an organization with any collaboration has exactly
-- one ACTIVE OWNER (C-05, CM-09). Checked per touched organization; deleted
-- rows are ignored (C-35).
CREATE FUNCTION collaborations_check_one_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  org_id uuid;
BEGIN
  FOR org_id IN
    SELECT DISTINCT o FROM unnest(
      CASE TG_OP
        WHEN 'INSERT' THEN ARRAY[NEW.organization_id]
        WHEN 'DELETE' THEN ARRAY[OLD.organization_id]
        ELSE ARRAY[NEW.organization_id, OLD.organization_id]
      END
    ) AS t(o)
  LOOP
    IF EXISTS (
        SELECT 1 FROM public.collaborations
        WHERE organization_id = org_id AND deleted_at IS NULL
      )
      AND (
        SELECT count(*) FROM public.collaborations
        WHERE organization_id = org_id AND role = 'OWNER' AND status = 'ACTIVE'
          AND deleted_at IS NULL
      ) <> 1
    THEN
      RAISE EXCEPTION 'an organization with collaborations needs exactly one ACTIVE OWNER'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "collaborations_one_active_owner"
AFTER INSERT OR UPDATE OR DELETE ON "collaborations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION collaborations_check_one_owner();

-- A released phone number can no longer be a public contact number.
CREATE FUNCTION people_clear_public_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.collaborations
  SET is_public_contact = false
  WHERE person_id = NEW.id AND is_public_contact;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "people_clear_public_contact"
AFTER UPDATE OF phone_number ON "people"
FOR EACH ROW
WHEN (NEW.phone_number IS NULL AND OLD.phone_number IS NOT NULL)
EXECUTE FUNCTION people_clear_public_contact();
