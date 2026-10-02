-- PER-003: keep identity and registration invariants enforced below application validation.
ALTER TABLE "people"
  ADD CONSTRAINT "people_phone_number_e164_check"
    CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "people_released_phone_number_e164_check"
    CHECK (released_phone_number IS NULL OR released_phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "people_exactly_one_phone_check"
    CHECK ((phone_number IS NULL) <> (released_phone_number IS NULL)),
  ADD CONSTRAINT "people_anonymized_phone_check"
    CHECK (status <> 'ANONYMIZED' OR phone_number IS NULL),
  ADD CONSTRAINT "people_phone_verification_check"
    CHECK (phone_number IS NOT NULL OR phone_verified_at IS NULL),
  ADD CONSTRAINT "people_registered_completeness_check"
    CHECK (
      registered_at IS NULL
      OR status = 'ANONYMIZED'
      OR (
        NULLIF(BTRIM(full_name), '') IS NOT NULL
        AND NULLIF(BTRIM(password_hash), '') IS NOT NULL
        AND (phone_number IS NULL OR phone_verified_at IS NOT NULL)
      )
    ),
  ADD CONSTRAINT "people_email_verification_check"
    CHECK (NULLIF(BTRIM(email), '') IS NOT NULL OR email_verified_at IS NULL);

ALTER TABLE "people" DROP CONSTRAINT "people_email_key";

CREATE UNIQUE INDEX "people_verified_email_lower_unique"
  ON "people" (LOWER(email))
  WHERE email_verified_at IS NOT NULL;
