-- FND-011: audit existing Person rows and install every integrity rule atomically.
BEGIN;

DO $$
DECLARE
  invalid_ids text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id::text)
  INTO invalid_ids
  FROM people
  WHERE NOT (
    (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$')
    AND (released_phone_number IS NULL OR released_phone_number ~ '^\+[1-9][0-9]{7,14}$')
    AND ((phone_number IS NULL) <> (released_phone_number IS NULL))
    AND (status <> 'ANONYMIZED' OR phone_number IS NULL)
    AND (phone_number IS NOT NULL OR phone_verified_at IS NULL)
    AND (
      registered_at IS NULL
      OR status = 'ANONYMIZED'
      OR (
        NULLIF(regexp_replace(full_name, '([[:space:]]|[              　])+', '', 'g'), '') IS NOT NULL
        AND NULLIF(regexp_replace(password_hash, '([[:space:]]|[              　])+', '', 'g'), '') IS NOT NULL
        AND (phone_number IS NULL OR phone_verified_at IS NOT NULL)
      )
    )
    AND (
      email_verified_at IS NULL
      OR NULLIF(regexp_replace(email, '([[:space:]]|[              　])+', '', 'g'), '') IS NOT NULL
    )
  );

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Person integrity preflight failed for ids: %s', invalid_ids);
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY id::text)
  INTO invalid_ids
  FROM people
  WHERE email_verified_at IS NOT NULL
    AND lower(email) IN (
      SELECT lower(email)
      FROM people
      WHERE email_verified_at IS NOT NULL
      GROUP BY lower(email)
      HAVING count(*) > 1
    );

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Verified email uniqueness preflight failed for ids: %s', invalid_ids);
  END IF;
END $$;

ALTER TABLE people
  ADD CONSTRAINT people_phone_number_e164_check
    CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT people_released_phone_number_e164_check
    CHECK (released_phone_number IS NULL OR released_phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT people_exactly_one_phone_check
    CHECK ((phone_number IS NULL) <> (released_phone_number IS NULL)),
  ADD CONSTRAINT people_anonymized_phone_check
    CHECK (status <> 'ANONYMIZED' OR phone_number IS NULL),
  ADD CONSTRAINT people_phone_verification_check
    CHECK (phone_number IS NOT NULL OR phone_verified_at IS NULL),
  ADD CONSTRAINT people_registered_completeness_check
    CHECK (
      registered_at IS NULL
      OR status = 'ANONYMIZED'
      OR (
        NULLIF(regexp_replace(full_name, '([[:space:]]|[              　])+', '', 'g'), '') IS NOT NULL
        AND NULLIF(regexp_replace(password_hash, '([[:space:]]|[              　])+', '', 'g'), '') IS NOT NULL
        AND (phone_number IS NULL OR phone_verified_at IS NOT NULL)
      )
    ),
  ADD CONSTRAINT people_email_verification_check
    CHECK (
      email_verified_at IS NULL
      OR NULLIF(regexp_replace(email, '([[:space:]]|[              　])+', '', 'g'), '') IS NOT NULL
    );

ALTER TABLE people DROP CONSTRAINT people_email_key;

CREATE UNIQUE INDEX people_verified_email_lower_unique
  ON people (lower(email))
  WHERE email_verified_at IS NOT NULL;

COMMIT;
