-- FND-011: align Person identifiers with the UUIDv7 data-model boundary atomically.
BEGIN;

DO $$
DECLARE
  invalid_ids text;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id)
  INTO invalid_ids
  FROM people
  WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Person identifier preflight failed for ids: %s', invalid_ids);
  END IF;
END $$;

ALTER TABLE tasks DROP CONSTRAINT "tasks_accountId_fkey";
ALTER TABLE phone_number_change_logs DROP CONSTRAINT phone_number_change_logs_person_id_fkey;

ALTER TABLE people ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE tasks ALTER COLUMN "accountId" TYPE uuid USING "accountId"::uuid;
ALTER TABLE phone_number_change_logs ALTER COLUMN person_id TYPE uuid USING person_id::uuid;

ALTER TABLE tasks ADD CONSTRAINT "tasks_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES people(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE phone_number_change_logs ADD CONSTRAINT phone_number_change_logs_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
