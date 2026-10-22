DO $$
DECLARE
  unresolved_ids text;
BEGIN
  SELECT string_agg(id::text, ',' ORDER BY id)
  INTO unresolved_ids
  FROM (
    SELECT id FROM organizations
    WHERE email IS NOT NULL AND deleted_at IS NULL
    ORDER BY id
    LIMIT 20
  ) AS unresolved;

  IF unresolved_ids IS NOT NULL THEN
    RAISE EXCEPTION '%: decide before dropping: see OPEN_QUESTIONS', unresolved_ids;
  END IF;
END
$$;

ALTER TABLE organizations DROP COLUMN email;
