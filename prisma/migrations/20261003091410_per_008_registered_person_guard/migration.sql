-- Reject unregistered people in trigger arguments naming author columns.
CREATE OR REPLACE FUNCTION require_registered_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  author_column text;
  author_id uuid;
  previous_author_id uuid;
BEGIN
  FOREACH author_column IN ARRAY TG_ARGV LOOP
    IF NOT (to_jsonb(NEW) ? author_column) THEN
      RAISE EXCEPTION 'invalid registered-person author column: %', author_column
        USING ERRCODE = '42703';
    END IF;

    BEGIN
      author_id := (to_jsonb(NEW) ->> author_column)::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid registered-person author column: %', author_column
          USING ERRCODE = '42703';
    END;

    IF author_id IS NULL THEN
      CONTINUE;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      previous_author_id := (to_jsonb(OLD) ->> author_column)::uuid;
      IF author_id IS NOT DISTINCT FROM previous_author_id THEN
        CONTINUE;
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.people
      WHERE id = author_id
        AND registered_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'author column % must reference a registered person', author_column
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
