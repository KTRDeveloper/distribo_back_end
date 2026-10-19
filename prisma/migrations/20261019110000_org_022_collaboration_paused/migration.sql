-- ORG-022: a collaboration can be PAUSED (over the plan limit: no access, still in the team).
-- Existing rows hold no PAUSED value, so the new CHECK already holds.
ALTER TYPE "CollaborationStatus" ADD VALUE IF NOT EXISTS 'PAUSED' AFTER 'ACTIVE';

-- C-42: the owner is never paused. The status is compared as text because a
-- value added to an enum cannot be used in the transaction that adds it.
ALTER TABLE "collaborations"
    ADD CONSTRAINT "collaborations_owner_not_paused"
    CHECK ("role" <> 'OWNER' OR "status"::text <> 'PAUSED');
