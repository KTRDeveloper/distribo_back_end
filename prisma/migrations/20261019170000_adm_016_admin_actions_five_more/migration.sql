-- AlterEnum
-- A value added here cannot be used in this same transaction, so every rule
-- below compares "action"::text with text instead of using the new values.
ALTER TYPE "AdminActionType" ADD VALUE 'GIFT_DAYS';
ALTER TYPE "AdminActionType" ADD VALUE 'RECORD_PAYMENT';
ALTER TYPE "AdminActionType" ADD VALUE 'REFUND_PAYMENT';
ALTER TYPE "AdminActionType" ADD VALUE 'RELEASE_PHONE';
ALTER TYPE "AdminActionType" ADD VALUE 'RESTORE_ACCESS';

-- Six actions are reserved to super administrators (C-29): REPLAY_SYNC and the
-- five new ones. Same 23514 refusal as the trigger this replaces.
DROP TRIGGER "admin_actions_check_replay_role" ON "admin_actions";
DROP FUNCTION admin_actions_check_replay_role();

CREATE FUNCTION admin_actions_check_super_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.action::text IN (
    'REPLAY_SYNC', 'GIFT_DAYS', 'RECORD_PAYMENT', 'REFUND_PAYMENT',
    'RELEASE_PHONE', 'RESTORE_ACCESS'
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.administrators
    WHERE id = NEW.administrator_id
      AND role = 'SUPER_ADMIN'
  ) THEN
    RAISE EXCEPTION '% requires a SUPER_ADMIN administrator', NEW.action::text
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "admin_actions_check_super_admin_role"
BEFORE INSERT OR UPDATE ON "admin_actions"
FOR EACH ROW EXECUTE FUNCTION admin_actions_check_super_admin_role();

-- The kind of target depends on the action (C-29): a business for GIFT_DAYS,
-- RECORD_PAYMENT and REFUND_PAYMENT, a person for RELEASE_PHONE and
-- RESTORE_ACCESS. No existing row holds these values: nothing to audit or fill.
ALTER TABLE "admin_actions"
    ADD CONSTRAINT "admin_actions_target_kind"
    CHECK (
        ("action"::text NOT IN ('GIFT_DAYS', 'RECORD_PAYMENT', 'REFUND_PAYMENT')
            OR "target_organization_id" IS NOT NULL)
        AND ("action"::text NOT IN ('RELEASE_PHONE', 'RESTORE_ACCESS')
            OR "target_person_id" IS NOT NULL)
    );
