CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Enforce C-52 for every writer, including concurrent inserts and updates.
-- Half-open periods may touch; zero-length periods are empty and overlap nothing.
ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_no_overlap"
    EXCLUDE USING gist (
        "organization_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    );
