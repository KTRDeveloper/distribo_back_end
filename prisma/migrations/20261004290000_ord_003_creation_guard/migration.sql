-- ORD-003: an order is created only on an ACTIVE, undeleted relationship whose
-- supplier is an ACTIVE organization (C-14). Counters (no customer) pass, as
-- the rule looks only at the relationship and the supplier.
-- Inserts only: orders already written stay valid when a business later closes.
CREATE FUNCTION orders_enforce_creation_guard()
RETURNS trigger AS $$
DECLARE
    rel_status "RelationshipStatus";
    rel_deleted_at timestamptz;
    rel_supplier_org uuid;
    org_status "OrganizationStatus";
BEGIN
    SELECT "status", "deleted_at", "supplier_organization_id"
        INTO rel_status, rel_deleted_at, rel_supplier_org
        FROM "customer_relationships"
        WHERE "id" = NEW."customer_relationship_id";

    -- An unknown relationship is left to the foreign key (23503), which refuses it.
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF rel_status IS DISTINCT FROM 'ACTIVE'
       OR rel_deleted_at IS NOT NULL
       OR rel_supplier_org IS NULL THEN
        RAISE EXCEPTION 'an order needs an ACTIVE relationship with an organization as supplier'
            USING ERRCODE = '23514';
    END IF;

    SELECT "status" INTO org_status FROM "organizations" WHERE "id" = rel_supplier_org;
    IF org_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'an order needs a supplier organization that is ACTIVE'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_creation_guard"
    BEFORE INSERT ON "orders"
    FOR EACH ROW EXECUTE FUNCTION orders_enforce_creation_guard();
