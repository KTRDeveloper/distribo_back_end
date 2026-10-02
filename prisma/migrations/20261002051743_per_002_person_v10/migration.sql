-- Drop old tables that reference Account
DROP TABLE IF EXISTS "otp_challenges" CASCADE;
DROP TABLE IF EXISTS "email_verification_requests" CASCADE;
DROP TABLE IF EXISTS "refresh_tokens" CASCADE;

-- Drop Account first (which will cascade to tasks foreign key if we let it)
DROP TABLE IF EXISTS "accounts" CASCADE;

-- Now tasks table exists but has no foreign key constraints
-- Repoint tasks to reference people(id)
-- First, drop the old foreign key if it exists
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_accountId_fkey";

-- Recreate people table with new schema
-- The people table already exists from baseline, so we need to transform it
-- Drop the entire people table
DROP TABLE IF EXISTS "people" CASCADE;

-- Create the new people table with v10 schema
CREATE TABLE "people" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "full_name" TEXT,
  "phone_number" TEXT UNIQUE,
  "released_phone_number" TEXT,
  "phone_verified_at" TIMESTAMP(3) WITH TIME ZONE,
  "email" TEXT UNIQUE,
  "email_verified_at" TIMESTAMP(3) WITH TIME ZONE,
  "password_hash" TEXT,
  "registered_at" TIMESTAMP(3) WITH TIME ZONE,
  "preferred_language" "Language",
  "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "status" "PersonStatus" NOT NULL DEFAULT 'ACTIVE',
  "anonymized_at" TIMESTAMP(3) WITH TIME ZONE,
  "server_updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "scope_version" INTEGER NOT NULL DEFAULT 0
);

-- Add trigger for server_updated_at
CREATE TRIGGER "set_server_updated_at_people"
BEFORE INSERT OR UPDATE ON "people"
FOR EACH ROW
EXECUTE FUNCTION set_server_updated_at();

-- Now add the foreign key from tasks to people
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
