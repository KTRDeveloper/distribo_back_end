-- REL-004: credit limit rules and the journal trigger (C-10).

-- Expand: new relationships start with a limit of 0 (no credit).
ALTER TABLE "customer_relationships" ALTER COLUMN "credit_limit" SET DEFAULT 0;

-- Migrate: bring existing rows in line before the checks are enforced.
-- The triggers below do not exist yet, so no journal row is written here.
UPDATE "customer_relationships"
SET "credit_limit" = 0
WHERE "customer_person_id" IS NULL
  AND "customer_organization_id" IS NULL
  AND "credit_limit" IS DISTINCT FROM 0;
UPDATE "customer_relationships"
SET "credit_limit_set_at" = "created_at"
WHERE "credit_limit_set_by_id" IS NOT NULL AND "credit_limit_set_at" IS NULL;
UPDATE "customer_relationships"
SET "credit_limit_set_at" = NULL
WHERE "credit_limit_set_by_id" IS NULL AND "credit_limit_set_at" IS NOT NULL;
UPDATE "customer_relationships" SET "credit_limit" = 0 WHERE "credit_limit" < 0;

-- Contract: enforce the rules.
ALTER TABLE "customer_relationships"
    -- A counter (no customer) never has credit: its limit is exactly 0.
    ADD CONSTRAINT "customer_relationships_counter_no_credit_check"
        CHECK (
            num_nonnulls("customer_person_id", "customer_organization_id") = 1
            OR COALESCE("credit_limit" = 0, false)
        ),
    -- A limit is never negative; an empty limit means no ceiling.
    ADD CONSTRAINT "customer_relationships_credit_limit_nonneg_check"
        CHECK ("credit_limit" IS NULL OR "credit_limit" >= 0),
    -- Author and time of the last limit decision are set together.
    ADD CONSTRAINT "customer_relationships_credit_limit_set_pair_check"
        CHECK (("credit_limit_set_by_id" IS NULL) = ("credit_limit_set_at" IS NULL));

-- A limit change must come with a new author. The server stamps the time, so
-- the caller cannot choose it. Runs before the row is written so the CHECKs
-- above see the final values (a change to an empty author fails the pair CHECK).
CREATE FUNCTION customer_relationships_stamp_credit_limit()
RETURNS trigger AS $$
BEGIN
    IF NEW."credit_limit_set_by_id" IS NOT DISTINCT FROM OLD."credit_limit_set_by_id" THEN
        RAISE EXCEPTION 'credit_limit change requires a new credit_limit_set_by_id'
            USING ERRCODE = '23514';
    END IF;
    NEW."credit_limit_set_at" := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "customer_relationships_stamp_credit_limit"
BEFORE UPDATE OF "credit_limit" ON "customer_relationships"
FOR EACH ROW
WHEN (OLD."credit_limit" IS DISTINCT FROM NEW."credit_limit")
EXECUTE FUNCTION customer_relationships_stamp_credit_limit();

-- Every limit change writes one journal row in the same transaction, so no
-- code path can change a limit without a trace. The id is a UUIDv7 built from
-- the clock and random bytes (PostgreSQL 16 has no native generator).
CREATE FUNCTION customer_relationships_journal_credit_limit()
RETURNS trigger AS $$
BEGIN
    INSERT INTO "credit_limit_changes" (
        "id", "customer_relationship_id", "previous_limit", "new_limit", "set_by_id", "set_at"
    )
    VALUES (
        encode(
            set_bit(
                set_bit(
                    overlay(
                        uuid_send(gen_random_uuid())
                        PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                        FROM 1 FOR 6
                    ),
                    52, 1
                ),
                53, 1
            ),
            'hex'
        )::uuid,
        NEW."id", OLD."credit_limit", NEW."credit_limit", NEW."credit_limit_set_by_id",
        NEW."credit_limit_set_at"
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "customer_relationships_journal_credit_limit"
AFTER UPDATE OF "credit_limit" ON "customer_relationships"
FOR EACH ROW
WHEN (OLD."credit_limit" IS DISTINCT FROM NEW."credit_limit")
EXECUTE FUNCTION customer_relationships_journal_credit_limit();
