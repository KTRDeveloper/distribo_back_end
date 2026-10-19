-- PER-010: profile photo key on the person. Existing rows keep an empty key, so the new rules already hold.
BEGIN;

ALTER TABLE people ADD COLUMN avatar_key text;

CREATE UNIQUE INDEX people_avatar_key_key ON people (avatar_key);

ALTER TABLE people
  ADD CONSTRAINT people_guest_avatar_check
    CHECK (registered_at IS NOT NULL OR avatar_key IS NULL),
  ADD CONSTRAINT people_anonymized_avatar_check
    CHECK (status <> 'ANONYMIZED' OR avatar_key IS NULL);

COMMIT;
