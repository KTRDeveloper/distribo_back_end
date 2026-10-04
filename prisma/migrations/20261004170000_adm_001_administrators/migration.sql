-- CreateEnum
CREATE TYPE "AdministratorRole" AS ENUM ('SUPER_ADMIN', 'MODERATOR');

-- CreateTable
CREATE TABLE "administrators" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "role" "AdministratorRole" NOT NULL,
    "totp_secret" TEXT NOT NULL,
    "recovery_email" TEXT,
    "appointed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ,

    CONSTRAINT "administrators_pkey" PRIMARY KEY ("id"),
    -- The second factor is mandatory and never blank (C-29, AB-1).
    CONSTRAINT "administrators_totp_secret_not_blank" CHECK (btrim("totp_secret") <> '')
);

-- AddForeignKey
ALTER TABLE "administrators"
    ADD CONSTRAINT "administrators_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- A person holds at most one live administrator row; a removed one does not
-- count, so a person can be appointed again.
CREATE UNIQUE INDEX "administrators_person_id_live_key"
    ON "administrators"("person_id")
    WHERE "removed_at" IS NULL;

-- An administrator must be a registered person, never a guest. Checked at
-- commit, like the other author columns (C-04). It runs after the foreign
-- key, so an unknown person id fails with 23503 first.
CREATE CONSTRAINT TRIGGER "administrators_require_registered_person"
AFTER INSERT OR UPDATE ON "administrators"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('person_id');

-- The recovery address must differ from the person's own email, ignoring
-- case (C-29).
CREATE FUNCTION administrators_check_recovery_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.recovery_email IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.people
    WHERE id = NEW.person_id
      AND email IS NOT NULL
      AND lower(email) = lower(NEW.recovery_email)
  ) THEN
    RAISE EXCEPTION 'recovery_email must differ from the person email'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "administrators_check_recovery_email"
BEFORE INSERT OR UPDATE ON "administrators"
FOR EACH ROW EXECUTE FUNCTION administrators_check_recovery_email();
