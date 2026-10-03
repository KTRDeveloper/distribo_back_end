-- FND-011: reject every Unicode White_Space code point in required text atomically.
BEGIN;

DO $$
DECLARE
  invalid_ids text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id::text)
  INTO invalid_ids
  FROM people
  WHERE NOT (
    registered_at IS NULL
    OR status = 'ANONYMIZED'
    OR (
      NULLIF(regexp_replace(full_name, '([[:space:]]|[               　])+', '', 'g'), '') IS NOT NULL
      AND NULLIF(regexp_replace(password_hash, '([[:space:]]|[               　])+', '', 'g'), '') IS NOT NULL
      AND (phone_number IS NULL OR phone_verified_at IS NOT NULL)
    )
  ) OR NOT (
    email_verified_at IS NULL
    OR NULLIF(regexp_replace(email, '([[:space:]]|[               　])+', '', 'g'), '') IS NOT NULL
  );

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Person Unicode nonblank preflight failed for ids: %s', invalid_ids);
  END IF;
END $$;

ALTER TABLE people
  DROP CONSTRAINT people_registered_completeness_check,
  DROP CONSTRAINT people_email_verification_check,
  ADD CONSTRAINT people_registered_completeness_check
    CHECK (
      registered_at IS NULL
      OR status = 'ANONYMIZED'
      OR (
        NULLIF(regexp_replace(full_name, '([[:space:]]|[               　])+', '', 'g'), '') IS NOT NULL
        AND NULLIF(regexp_replace(password_hash, '([[:space:]]|[               　])+', '', 'g'), '') IS NOT NULL
        AND (phone_number IS NULL OR phone_verified_at IS NOT NULL)
      )
    ),
  ADD CONSTRAINT people_email_verification_check
    CHECK (
      email_verified_at IS NULL
      OR NULLIF(regexp_replace(email, '([[:space:]]|[               　])+', '', 'g'), '') IS NOT NULL
    );

COMMIT;
