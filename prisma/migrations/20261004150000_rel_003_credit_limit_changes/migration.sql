-- CreateTable
CREATE TABLE "credit_limit_changes" (
    "id" UUID NOT NULL,
    "customer_relationship_id" UUID NOT NULL,
    "previous_limit" BIGINT,
    "new_limit" BIGINT,
    "set_by_id" UUID NOT NULL,
    "set_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_limit_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_limit_changes_customer_relationship_id_idx"
    ON "credit_limit_changes"("customer_relationship_id");

-- AddForeignKey
ALTER TABLE "credit_limit_changes"
    ADD CONSTRAINT "credit_limit_changes_customer_relationship_id_fkey"
    FOREIGN KEY ("customer_relationship_id") REFERENCES "customer_relationships"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "credit_limit_changes"
    ADD CONSTRAINT "credit_limit_changes_set_by_id_fkey"
    FOREIGN KEY ("set_by_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The author of a credit decision must be a registered person. Checked at
-- commit, like the other author columns.
CREATE CONSTRAINT TRIGGER "credit_limit_changes_require_registered_author"
AFTER INSERT OR UPDATE ON "credit_limit_changes"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('set_by_id');

CREATE TRIGGER "credit_limit_changes_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "credit_limit_changes"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();

-- The journal is append-only for the application account (C-32/C-39).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "credit_limit_changes" FROM distribo_app;
