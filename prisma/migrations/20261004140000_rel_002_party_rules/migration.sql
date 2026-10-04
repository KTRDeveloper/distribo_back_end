-- Party rules: who the two sides of a relationship are.
ALTER TABLE "customer_relationships"
    -- Exactly one supplier: an organization or a person.
    ADD CONSTRAINT "customer_relationships_one_supplier_check"
        CHECK (num_nonnulls("supplier_organization_id", "supplier_person_id") = 1),
    -- At most one customer; no customer is a counter.
    ADD CONSTRAINT "customer_relationships_one_customer_check"
        CHECK (num_nonnulls("customer_person_id", "customer_organization_id") <= 1),
    -- A counter has no customer, so it must carry a name.
    ADD CONSTRAINT "customer_relationships_counter_label_check"
        CHECK (
            num_nonnulls("customer_person_id", "customer_organization_id") = 1
            OR COALESCE(length(btrim("customer_label")), 0) > 0
        ),
    -- The typed phone number is cleared once the customer person is known.
    ADD CONSTRAINT "customer_relationships_phone_cleared_check"
        CHECK ("customer_person_id" IS NULL OR "customer_phone_number" IS NULL),
    -- An organization is never its own customer.
    ADD CONSTRAINT "customer_relationships_distinct_organizations_check"
        CHECK (
            "supplier_organization_id" IS NULL
            OR "customer_organization_id" IS NULL
            OR "supplier_organization_id" <> "customer_organization_id"
        ),
    -- A merged duplicate is always deleted.
    ADD CONSTRAINT "customer_relationships_merged_is_deleted_check"
        CHECK ("merged_into_id" IS NULL OR "deleted_at" IS NOT NULL),
    -- PENDING if and only if the supplier is a person (an invitation).
    ADD CONSTRAINT "customer_relationships_pending_iff_supplier_person_check"
        CHECK (("status" = 'PENDING') = ("supplier_person_id" IS NOT NULL)),
    -- ended_by_party is set if and only if the relationship is ENDED.
    ADD CONSTRAINT "customer_relationships_ended_by_iff_ended_check"
        CHECK (("ended_by_party" IS NOT NULL) = ("status" = 'ENDED'));

-- One live relationship per (supplier, customer) pair. Deleted and merged
-- rows do not count. A counter has no customer id, so a NULL never collides.
CREATE UNIQUE INDEX "customer_relationships_live_org_person_key"
    ON "customer_relationships"("supplier_organization_id", "customer_person_id")
    WHERE "deleted_at" IS NULL AND "merged_into_id" IS NULL;
CREATE UNIQUE INDEX "customer_relationships_live_org_org_key"
    ON "customer_relationships"("supplier_organization_id", "customer_organization_id")
    WHERE "deleted_at" IS NULL AND "merged_into_id" IS NULL;
CREATE UNIQUE INDEX "customer_relationships_live_person_person_key"
    ON "customer_relationships"("supplier_person_id", "customer_person_id")
    WHERE "deleted_at" IS NULL AND "merged_into_id" IS NULL;
CREATE UNIQUE INDEX "customer_relationships_live_person_org_key"
    ON "customer_relationships"("supplier_person_id", "customer_organization_id")
    WHERE "deleted_at" IS NULL AND "merged_into_id" IS NULL;
