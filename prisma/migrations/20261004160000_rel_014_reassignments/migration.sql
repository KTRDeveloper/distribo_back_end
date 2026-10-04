-- CreateTable
CREATE TABLE "customer_relationship_reassignments" (
    "id" UUID NOT NULL,
    "customer_relationship_id" UUID NOT NULL,
    "previous_person_id" UUID NOT NULL,
    "new_person_id" UUID NOT NULL,
    "reassigned_by_id" UUID NOT NULL,
    "reason" TEXT,
    "reassigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_relationship_reassignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_relationship_reassignments_customer_relationship_i_idx"
    ON "customer_relationship_reassignments"("customer_relationship_id");

-- AddForeignKey
ALTER TABLE "customer_relationship_reassignments"
    ADD CONSTRAINT "customer_relationship_reassignments_customer_relationship__fkey"
    FOREIGN KEY ("customer_relationship_id") REFERENCES "customer_relationships"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_relationship_reassignments"
    ADD CONSTRAINT "customer_relationship_reassignments_previous_person_id_fkey"
    FOREIGN KEY ("previous_person_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_relationship_reassignments"
    ADD CONSTRAINT "customer_relationship_reassignments_new_person_id_fkey"
    FOREIGN KEY ("new_person_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_relationship_reassignments"
    ADD CONSTRAINT "customer_relationship_reassignments_reassigned_by_id_fkey"
    FOREIGN KEY ("reassigned_by_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- One contestation (the previous person moving the relationship themselves)
-- per relationship and person; corrections by others are unlimited (C-12).
CREATE UNIQUE INDEX "customer_relationship_reassignments_one_contestation_key"
    ON "customer_relationship_reassignments"("customer_relationship_id", "previous_person_id")
    WHERE "reassigned_by_id" = "previous_person_id";

-- The author of a change must be a registered person. Checked at commit,
-- like the other author columns (C-04).
CREATE CONSTRAINT TRIGGER "customer_relationship_reassignments_require_registered_author"
AFTER INSERT OR UPDATE ON "customer_relationship_reassignments"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('reassigned_by_id');

CREATE TRIGGER "customer_relationship_reassignments_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "customer_relationship_reassignments"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();

-- The journal is append-only for the application account (C-32/C-39).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "customer_relationship_reassignments" FROM distribo_app;
