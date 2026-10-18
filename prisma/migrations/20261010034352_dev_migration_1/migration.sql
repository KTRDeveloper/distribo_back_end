/*
  Warnings:

  - You are about to drop the column `accountId` on the `tasks` table. All the data in the column will be lost.
  - Made the column `balance_effect` on table `ledger_entries` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `account_id` to the `tasks` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_report_id_fkey";

-- DropForeignKey
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_sync_archive_id_fkey";

-- DropForeignKey
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_target_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_target_person_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_relationships" DROP CONSTRAINT "customer_relationships_credit_limit_set_by_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_relationships" DROP CONSTRAINT "customer_relationships_customer_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_relationships" DROP CONSTRAINT "customer_relationships_customer_person_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_relationships" DROP CONSTRAINT "customer_relationships_merged_into_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_relationships" DROP CONSTRAINT "customer_relationships_supplier_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_relationships" DROP CONSTRAINT "customer_relationships_supplier_person_id_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_price_set_by_id_fkey";

-- DropForeignKey
ALTER TABLE "otp_challenges" DROP CONSTRAINT "otp_challenges_person_id_fkey";

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_resolved_by_id_fkey";

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_target_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_target_person_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_accountId_fkey";

-- DropIndex
DROP INDEX "tasks_accountId_status_idx";

-- AlterTable
ALTER TABLE "ledger_entries" ALTER COLUMN "balance_effect" SET NOT NULL;

-- AlterTable
ALTER TABLE "people" ALTER COLUMN "phone_verified_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "email_verified_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "registered_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "anonymized_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "server_updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "accountId",
ADD COLUMN     "account_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "administrators_person_id_idx" ON "administrators"("person_id");

-- CreateIndex
CREATE INDEX "tasks_account_id_status_idx" ON "tasks"("account_id", "status");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_relationships" ADD CONSTRAINT "customer_relationships_supplier_organization_id_fkey" FOREIGN KEY ("supplier_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_relationships" ADD CONSTRAINT "customer_relationships_supplier_person_id_fkey" FOREIGN KEY ("supplier_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_relationships" ADD CONSTRAINT "customer_relationships_customer_person_id_fkey" FOREIGN KEY ("customer_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_relationships" ADD CONSTRAINT "customer_relationships_customer_organization_id_fkey" FOREIGN KEY ("customer_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_relationships" ADD CONSTRAINT "customer_relationships_credit_limit_set_by_id_fkey" FOREIGN KEY ("credit_limit_set_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_relationships" ADD CONSTRAINT "customer_relationships_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "customer_relationships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_sync_archive_id_fkey" FOREIGN KEY ("sync_archive_id") REFERENCES "sync_archives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_target_person_id_fkey" FOREIGN KEY ("target_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_target_organization_id_fkey" FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_person_id_fkey" FOREIGN KEY ("target_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_organization_id_fkey" FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "administrators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_price_set_by_id_fkey" FOREIGN KEY ("price_set_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
