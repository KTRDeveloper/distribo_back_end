-- CreateEnum
CREATE TYPE "OrganizationContactKind" AS ENUM ('PHONE', 'EMAIL');

-- CreateEnum
CREATE TYPE "ContactVerificationMethod" AS ENUM ('CODE', 'OWNER_PHONE');

-- CreateTable
CREATE TABLE "organization_contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "OrganizationContactKind" NOT NULL,
    "slot" INTEGER,
    "value" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "verification_method" "ContactVerificationMethod",
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "server_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "organization_contacts_pkey" PRIMARY KEY ("id"),
    -- A slot is set exactly for a phone number and is 1, 2 or 3 (C-43).
    CONSTRAINT "organization_contacts_slot_matches_kind"
        CHECK (("slot" IS NOT NULL) = ("kind" = 'PHONE')),
    CONSTRAINT "organization_contacts_slot_range"
        CHECK ("slot" IS NULL OR "slot" BETWEEN 1 AND 3),
    -- A phone number is in E.164 format (C-43).
    CONSTRAINT "organization_contacts_phone_format"
        CHECK ("kind" <> 'PHONE' OR "value" ~ '^\+[1-9][0-9]{7,14}$'),
    -- An email is stored in lower case.
    CONSTRAINT "organization_contacts_email_lower"
        CHECK ("kind" <> 'EMAIL' OR "value" = lower("value")),
    -- The method is set exactly when the contact is verified (C-43).
    CONSTRAINT "organization_contacts_method_matches_verified"
        CHECK (("verification_method" IS NOT NULL) = ("verified_at" IS NOT NULL))
);

-- CreateIndex
CREATE INDEX "organization_contacts_organization_id_idx"
    ON "organization_contacts"("organization_id");

-- The uniqueness rules ignore deleted rows (C-35, C-43), so they are partial
-- indexes and not @@unique in the Prisma schema.
CREATE UNIQUE INDEX "organization_contacts_organization_id_slot_key"
    ON "organization_contacts"("organization_id", "slot")
    WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "organization_contacts_organization_id_value_key"
    ON "organization_contacts"("organization_id", "value")
    WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "organization_contacts_one_email_key"
    ON "organization_contacts"("organization_id")
    WHERE "kind" = 'EMAIL' AND "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "organization_contacts"
    ADD CONSTRAINT "organization_contacts_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_contacts"
    ADD CONSTRAINT "organization_contacts_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The server owns server_updated_at (C-35).
CREATE TRIGGER "organization_contacts_set_server_updated_at"
BEFORE INSERT OR UPDATE ON "organization_contacts"
FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
