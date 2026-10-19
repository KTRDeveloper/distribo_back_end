-- ORG-023: a one-time code can be tied to a business contact.
-- Existing rows have no contact and none uses ORG_CONTACT_VERIFICATION yet,
-- so the CHECK already holds on them.
ALTER TABLE "otp_challenges" ADD COLUMN "organization_contact_id" UUID;

ALTER TABLE "otp_challenges"
    ADD CONSTRAINT "otp_challenges_organization_contact_id_fkey"
    FOREIGN KEY ("organization_contact_id") REFERENCES "organization_contacts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- C-33: the contact is set exactly when the purpose is ORG_CONTACT_VERIFICATION.
-- The purpose is compared as text to stay safe with enum values added recently.
ALTER TABLE "otp_challenges"
    ADD CONSTRAINT "otp_challenges_contact_matches_purpose"
    CHECK (("purpose"::text = 'ORG_CONTACT_VERIFICATION') = ("organization_contact_id" IS NOT NULL));
