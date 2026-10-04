CREATE TYPE "RelationshipStatus" AS ENUM ('PENDING', 'ACTIVE', 'ENDED');
CREATE TYPE "RelationshipParty" AS ENUM ('CUSTOMER', 'SUPPLIER');

CREATE TABLE "customer_relationships" (
    "id" UUID NOT NULL,
    "supplier_organization_id" UUID,
    "supplier_person_id" UUID,
    "customer_person_id" UUID,
    "customer_organization_id" UUID,
    "customer_phone_number" TEXT,
    "customer_label" TEXT,
    "supplier_label" TEXT,
    "delivery_address" TEXT,
    "credit_limit" BIGINT,
    "credit_limit_set_by_id" UUID,
    "credit_limit_set_at" TIMESTAMPTZ,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "ended_by_party" "RelationshipParty",
    "supplier_notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merged_into_id" UUID,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "customer_relationships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_relationships_supplier_organization_id_fkey" FOREIGN KEY ("supplier_organization_id")
        REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_relationships_supplier_person_id_fkey" FOREIGN KEY ("supplier_person_id")
        REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_relationships_customer_person_id_fkey" FOREIGN KEY ("customer_person_id")
        REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_relationships_customer_organization_id_fkey" FOREIGN KEY ("customer_organization_id")
        REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_relationships_credit_limit_set_by_id_fkey" FOREIGN KEY ("credit_limit_set_by_id")
        REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_relationships_created_by_id_fkey" FOREIGN KEY ("created_by_id")
        REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_relationships_merged_into_id_fkey" FOREIGN KEY ("merged_into_id")
        REFERENCES "customer_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "customer_relationships_supplier_organization_id_idx"
    ON "customer_relationships"("supplier_organization_id");
CREATE INDEX "customer_relationships_supplier_person_id_idx"
    ON "customer_relationships"("supplier_person_id");
CREATE INDEX "customer_relationships_customer_person_id_idx"
    ON "customer_relationships"("customer_person_id");
CREATE INDEX "customer_relationships_customer_organization_id_idx"
    ON "customer_relationships"("customer_organization_id");

-- The author and the person who set the credit limit must be registered
-- people. Checked at commit, like the other author columns.
CREATE CONSTRAINT TRIGGER "customer_relationships_require_registered_author"
AFTER INSERT OR UPDATE ON "customer_relationships"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_registered_person('created_by_id', 'credit_limit_set_by_id');

CREATE TRIGGER "customer_relationships_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "customer_relationships"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
