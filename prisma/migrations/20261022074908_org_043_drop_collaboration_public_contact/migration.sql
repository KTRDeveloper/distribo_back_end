BEGIN;

-- Hold the table through preflight and removal so no concurrent flag can be lost.
LOCK TABLE collaborations IN ACCESS EXCLUSIVE MODE;

-- Only live flags need an owner's decision. Diagnostics contain at most 20 ids.
DO $$
DECLARE
  flagged_ids text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id) INTO flagged_ids
  FROM (
    SELECT id FROM collaborations
    WHERE deleted_at IS NULL AND is_public_contact
    ORDER BY id
    LIMIT 20
  ) AS flagged;

  IF flagged_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Live public-contact collaborations: %', flagged_ids;
  END IF;
END;
$$;

-- C-05 still forbids ACTIVE memberships for guests; only the retired flag rule goes.
CREATE OR REPLACE FUNCTION public.collaborations_check_row()
RETURNS trigger
LANGUAGE plpgsql
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

  RETURN NEW;
END;
$$;

DROP TRIGGER people_clear_public_contact ON public.people;
DROP FUNCTION public.people_clear_public_contact();
ALTER TABLE public.collaborations DROP COLUMN is_public_contact;

COMMIT;
