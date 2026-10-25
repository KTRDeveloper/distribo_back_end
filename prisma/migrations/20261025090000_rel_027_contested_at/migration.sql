-- REL-027: a contestation leaves a mark on the relationship instead of moving it.
-- Additive and looser: existing rows get NULL, no backfill.

-- AlterTable
ALTER TABLE "customer_relationships" ADD COLUMN "contested_at" TIMESTAMPTZ;

-- A counter (no customer person and no customer organization) is never marked (C-57).
ALTER TABLE "customer_relationships"
    ADD CONSTRAINT "customer_relationships_counter_not_contested_check"
    CHECK (
        "contested_at" IS NULL
        OR num_nonnulls("customer_person_id", "customer_organization_id") = 1
    );

-- A contestation no longer writes a journal entry, so the one-contestation rule ends (C-12).
-- Past entries stay: the journal is immutable and keeps insert and select only.
DROP INDEX "customer_relationship_reassignments_one_contestation_key";
