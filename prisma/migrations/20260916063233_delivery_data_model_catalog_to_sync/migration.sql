-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('BEFORE_DELIVERY', 'AFTER_COLLECTION');

-- CreateEnum
CREATE TYPE "PartnershipStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'REFUSED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('DIRECT', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "ChannelRelationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ChannelChangeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'IN_RETENTION', 'FREE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PENDING_STOCK', 'CONFIRMED', 'IN_DELIVERY', 'PARTIALLY_DELIVERED', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntryMode" AS ENUM ('SELF_SERVICE', 'ASSISTED');

-- CreateEnum
CREATE TYPE "OrderLineChangeType" AS ENUM ('LINE_ADDED', 'LINE_REMOVED', 'QUANTITY_UPDATED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('MOBILE_MONEY', 'MANUAL_CASH');

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('OUTSTANDING', 'SETTLED');

-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SharingDefaultRule" AS ENUM ('SHARE', 'DO_NOT_SHARE');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReportDecision" AS ENUM ('DISMISSED', 'SUSPENSION');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'MODERATOR');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS');

-- CreateEnum
CREATE TYPE "ReadStatus" AS ENUM ('UNREAD', 'READ');

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "businessOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "rangeName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "catalogPrice" DECIMAL(14,2) NOT NULL,
    "defaultWholesalePrice" DECIMAL(14,2),
    "status" "VariantStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "quantityAvailable" DECIMAL(14,3) NOT NULL,
    "alertThreshold" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "sourceOrderId" TEXT,
    "recordedById" TEXT NOT NULL,
    "note" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_agreements" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "paymentTerms" "PaymentTerms" NOT NULL,
    "status" "PartnershipStatus" NOT NULL DEFAULT 'REQUESTED',
    "initiatorId" TEXT NOT NULL,
    "initiatorNote" TEXT,
    "recipientNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refusedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),

    CONSTRAINT "partnership_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_products" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "PartnershipStatus" NOT NULL DEFAULT 'REQUESTED',
    "initiatorId" TEXT NOT NULL,
    "initiatorNote" TEXT,
    "recipientNote" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refusedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "terminationStockCleared" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "partnership_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_wholesale_prices" (
    "id" TEXT NOT NULL,
    "partnershipProductId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "wholesalePrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "product_wholesale_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_channel_relations" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "channelType" "ChannelType" NOT NULL,
    "contractorId" TEXT,
    "status" "ChannelRelationStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_channel_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_change_requests" (
    "id" TEXT NOT NULL,
    "currentRelationId" TEXT NOT NULL,
    "newChannelType" "ChannelType" NOT NULL,
    "newContractorId" TEXT,
    "status" "ChannelChangeStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionEndAt" TIMESTAMP(3),

    CONSTRAINT "channel_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "issuerType" "PartyType" NOT NULL,
    "issuerId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channelRelationId" TEXT,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "deliveryCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desiredDeliveryDate" DATE,
    "desiredSlotStart" TIME,
    "desiredSlotEnd" TIME,
    "cancellationDeadline" TIMESTAMP(3),
    "cancellationFee" DECIMAL(14,2),
    "entryMode" "EntryMode" NOT NULL DEFAULT 'SELF_SERVICE',
    "enteredById" TEXT,
    "parentOrderId" TEXT,
    "issuerNote" TEXT,
    "recipientNote" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "deliveredQuantity" DECIMAL(14,3),
    "unitPriceApplied" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_changes" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changeType" "OrderLineChangeType" NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "previousQuantity" DECIMAL(14,3),
    "newQuantity" DECIMAL(14,3),
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_line_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "amountToCollect" DECIMAL(14,2) NOT NULL,
    "amountCollected" DECIMAL(14,2),
    "departureLat" DECIMAL(9,6),
    "departureLng" DECIMAL(9,6),
    "departedAt" TIMESTAMP(3),
    "arrivalLat" DECIMAL(9,6),
    "arrivalLng" DECIMAL(9,6),
    "arrivedAt" TIMESTAMP(3),

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "payerType" "PartyType" NOT NULL,
    "payerId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "amountAllocated" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "mode" "PaymentMode" NOT NULL,
    "transactionReference" TEXT,
    "recordedById" TEXT NOT NULL,
    "remittedAt" TIMESTAMP(3),
    "note" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debts" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "debtorType" "PartyType" NOT NULL,
    "debtorId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "amountDue" DECIMAL(14,2) NOT NULL,
    "amountSettled" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "note" TEXT,
    "status" "DebtStatus" NOT NULL DEFAULT 'OUTSTANDING',

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_settlements" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountAllocated" DECIMAL(14,2) NOT NULL,
    "allocationMode" "AllocationMode" NOT NULL,
    "reversesSettlementId" TEXT,
    "recordedById" TEXT,
    "note" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "beneficiaryType" "PartyType" NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "transactionReference" TEXT,
    "relatedDebtId" TEXT,
    "recordedById" TEXT NOT NULL,
    "note" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_ceilings" (
    "id" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "debtorType" "PartyType" NOT NULL,
    "maxAmount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "debt_ceilings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileUrl" TEXT NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operating_cost_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT,

    CONSTRAINT "operating_cost_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operating_costs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "recordedById" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operating_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operating_cost_order_links" (
    "operatingCostId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "operating_cost_order_links_pkey" PRIMARY KEY ("operatingCostId","orderId")
);

-- CreateTable
CREATE TABLE "info_sharing_rules" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "defaultRule" "SharingDefaultRule" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "info_sharing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sharing_exceptions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "share" BOOLEAN NOT NULL,

    CONSTRAINT "customer_sharing_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publiclyVisible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" "PartyType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedById" TEXT,
    "decision" "ReportDecision",
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrators" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "appointedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "organizationId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "content" TEXT NOT NULL,
    "sourceEvent" TEXT NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "readStatus" "ReadStatus" NOT NULL DEFAULT 'UNREAD',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_actions" (
    "accountId" TEXT NOT NULL,
    "pendingActionId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_actions_pkey" PRIMARY KEY ("accountId","pendingActionId")
);

-- CreateIndex
CREATE INDEX "products_businessOrganizationId_idx" ON "products"("businessOrganizationId");

-- CreateIndex
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");

-- CreateIndex
CREATE INDEX "stocks_productVariantId_idx" ON "stocks"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "stocks_organizationId_productVariantId_key" ON "stocks"("organizationId", "productVariantId");

-- CreateIndex
CREATE INDEX "stock_movements_stockId_idx" ON "stock_movements"("stockId");

-- CreateIndex
CREATE INDEX "stock_movements_sourceOrderId_idx" ON "stock_movements"("sourceOrderId");

-- CreateIndex
CREATE INDEX "partnership_agreements_businessId_idx" ON "partnership_agreements"("businessId");

-- CreateIndex
CREATE INDEX "partnership_agreements_contractorId_idx" ON "partnership_agreements"("contractorId");

-- CreateIndex
CREATE INDEX "partnership_products_productId_idx" ON "partnership_products"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "partnership_products_agreementId_productId_key" ON "partnership_products"("agreementId", "productId");

-- CreateIndex
CREATE INDEX "product_wholesale_prices_partnershipProductId_idx" ON "product_wholesale_prices"("partnershipProductId");

-- CreateIndex
CREATE INDEX "product_wholesale_prices_productVariantId_idx" ON "product_wholesale_prices"("productVariantId");

-- CreateIndex
CREATE INDEX "customer_channel_relations_personId_idx" ON "customer_channel_relations"("personId");

-- CreateIndex
CREATE INDEX "customer_channel_relations_businessId_productId_idx" ON "customer_channel_relations"("businessId", "productId");

-- CreateIndex
CREATE INDEX "customer_channel_relations_contractorId_idx" ON "customer_channel_relations"("contractorId");

-- CreateIndex
CREATE INDEX "channel_change_requests_currentRelationId_idx" ON "channel_change_requests"("currentRelationId");

-- CreateIndex
CREATE INDEX "orders_issuerType_issuerId_idx" ON "orders"("issuerType", "issuerId");

-- CreateIndex
CREATE INDEX "orders_recipientId_idx" ON "orders"("recipientId");

-- CreateIndex
CREATE INDEX "orders_channelRelationId_idx" ON "orders"("channelRelationId");

-- CreateIndex
CREATE INDEX "orders_parentOrderId_idx" ON "orders"("parentOrderId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "order_lines_orderId_idx" ON "order_lines"("orderId");

-- CreateIndex
CREATE INDEX "order_lines_productVariantId_idx" ON "order_lines"("productVariantId");

-- CreateIndex
CREATE INDEX "order_line_changes_orderId_idx" ON "order_line_changes"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_orderId_key" ON "deliveries"("orderId");

-- CreateIndex
CREATE INDEX "deliveries_assignedToId_idx" ON "deliveries"("assignedToId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_payerType_payerId_idx" ON "payments"("payerType", "payerId");

-- CreateIndex
CREATE INDEX "payments_creditorId_idx" ON "payments"("creditorId");

-- CreateIndex
CREATE INDEX "payments_recordedById_idx" ON "payments"("recordedById");

-- CreateIndex
CREATE INDEX "debts_orderId_idx" ON "debts"("orderId");

-- CreateIndex
CREATE INDEX "debts_debtorType_debtorId_idx" ON "debts"("debtorType", "debtorId");

-- CreateIndex
CREATE INDEX "debts_creditorId_idx" ON "debts"("creditorId");

-- CreateIndex
CREATE INDEX "debts_status_idx" ON "debts"("status");

-- CreateIndex
CREATE INDEX "debt_settlements_debtId_idx" ON "debt_settlements"("debtId");

-- CreateIndex
CREATE INDEX "debt_settlements_paymentId_idx" ON "debt_settlements"("paymentId");

-- CreateIndex
CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");

-- CreateIndex
CREATE INDEX "refunds_beneficiaryType_beneficiaryId_idx" ON "refunds"("beneficiaryType", "beneficiaryId");

-- CreateIndex
CREATE INDEX "refunds_organizationId_idx" ON "refunds"("organizationId");

-- CreateIndex
CREATE INDEX "refunds_relatedDebtId_idx" ON "refunds"("relatedDebtId");

-- CreateIndex
CREATE INDEX "debt_ceilings_creditorId_idx" ON "debt_ceilings"("creditorId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_orderId_key" ON "receipts"("orderId");

-- CreateIndex
CREATE INDEX "subscriptions_businessId_idx" ON "subscriptions"("businessId");

-- CreateIndex
CREATE INDEX "operating_cost_categories_organizationId_idx" ON "operating_cost_categories"("organizationId");

-- CreateIndex
CREATE INDEX "operating_costs_organizationId_idx" ON "operating_costs"("organizationId");

-- CreateIndex
CREATE INDEX "operating_costs_categoryId_idx" ON "operating_costs"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "info_sharing_rules_contractorId_businessId_key" ON "info_sharing_rules"("contractorId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sharing_exceptions_ruleId_customerId_key" ON "customer_sharing_exceptions"("ruleId", "customerId");

-- CreateIndex
CREATE INDEX "ratings_contractorId_idx" ON "ratings"("contractorId");

-- CreateIndex
CREATE INDEX "ratings_orderId_idx" ON "ratings"("orderId");

-- CreateIndex
CREATE INDEX "reports_reporterId_idx" ON "reports"("reporterId");

-- CreateIndex
CREATE INDEX "reports_targetType_targetId_idx" ON "reports"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "administrators_accountId_key" ON "administrators"("accountId");

-- CreateIndex
CREATE INDEX "notifications_recipientId_readStatus_idx" ON "notifications"("recipientId", "readStatus");

-- CreateIndex
CREATE INDEX "notifications_organizationId_idx" ON "notifications"("organizationId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_businessOrganizationId_fkey" FOREIGN KEY ("businessOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_agreements" ADD CONSTRAINT "partnership_agreements_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_agreements" ADD CONSTRAINT "partnership_agreements_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_agreements" ADD CONSTRAINT "partnership_agreements_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_products" ADD CONSTRAINT "partnership_products_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "partnership_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_products" ADD CONSTRAINT "partnership_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_products" ADD CONSTRAINT "partnership_products_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_wholesale_prices" ADD CONSTRAINT "product_wholesale_prices_partnershipProductId_fkey" FOREIGN KEY ("partnershipProductId") REFERENCES "partnership_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_wholesale_prices" ADD CONSTRAINT "product_wholesale_prices_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_channel_relations" ADD CONSTRAINT "customer_channel_relations_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_channel_relations" ADD CONSTRAINT "customer_channel_relations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_channel_relations" ADD CONSTRAINT "customer_channel_relations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_channel_relations" ADD CONSTRAINT "customer_channel_relations_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_change_requests" ADD CONSTRAINT "channel_change_requests_currentRelationId_fkey" FOREIGN KEY ("currentRelationId") REFERENCES "customer_channel_relations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_change_requests" ADD CONSTRAINT "channel_change_requests_newContractorId_fkey" FOREIGN KEY ("newContractorId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_channelRelationId_fkey" FOREIGN KEY ("channelRelationId") REFERENCES "customer_channel_relations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_changes" ADD CONSTRAINT "order_line_changes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_changes" ADD CONSTRAINT "order_line_changes_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_changes" ADD CONSTRAINT "order_line_changes_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_creditorId_fkey" FOREIGN KEY ("creditorId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_creditorId_fkey" FOREIGN KEY ("creditorId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_settlements" ADD CONSTRAINT "debt_settlements_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "debts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_settlements" ADD CONSTRAINT "debt_settlements_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_settlements" ADD CONSTRAINT "debt_settlements_reversesSettlementId_fkey" FOREIGN KEY ("reversesSettlementId") REFERENCES "debt_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_settlements" ADD CONSTRAINT "debt_settlements_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_relatedDebtId_fkey" FOREIGN KEY ("relatedDebtId") REFERENCES "debts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_ceilings" ADD CONSTRAINT "debt_ceilings_creditorId_fkey" FOREIGN KEY ("creditorId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_cost_categories" ADD CONSTRAINT "operating_cost_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_costs" ADD CONSTRAINT "operating_costs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_costs" ADD CONSTRAINT "operating_costs_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "operating_cost_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_costs" ADD CONSTRAINT "operating_costs_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_cost_order_links" ADD CONSTRAINT "operating_cost_order_links_operatingCostId_fkey" FOREIGN KEY ("operatingCostId") REFERENCES "operating_costs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_cost_order_links" ADD CONSTRAINT "operating_cost_order_links_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "info_sharing_rules" ADD CONSTRAINT "info_sharing_rules_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "info_sharing_rules" ADD CONSTRAINT "info_sharing_rules_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sharing_exceptions" ADD CONSTRAINT "customer_sharing_exceptions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "info_sharing_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sharing_exceptions" ADD CONSTRAINT "customer_sharing_exceptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "administrators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrators" ADD CONSTRAINT "administrators_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_actions" ADD CONSTRAINT "processed_actions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written constraints (not expressible in schema.prisma without the
-- `extendedIndexes` preview feature, which this project does not enable —
-- see data-model/modele-donnees-livraisons.md, "Contraintes à poser au
-- niveau base de données").
-- =====================================================================

-- §3.4 CustomerChannelRelation: only one ACTIVE channel per (person,
-- business, product) — a partial unique index, not a plain @@unique,
-- because SUSPENDED rows must not collide.
CREATE UNIQUE INDEX "customer_channel_relations_active_unique"
    ON "customer_channel_relations" ("personId", "businessId", "productId")
    WHERE "status" = 'ACTIVE';

-- §4.1 Order: desired delivery slot is a wish, never a commitment, but the
-- three fields must still be internally consistent — no time without a
-- date, both bounds together, and the end strictly after the start.
ALTER TABLE "orders" ADD CONSTRAINT "orders_desired_slot_check" CHECK (
    ("desiredSlotStart" IS NULL AND "desiredSlotEnd" IS NULL)
    OR (
        "desiredSlotStart" IS NOT NULL
        AND "desiredSlotEnd" IS NOT NULL
        AND "desiredDeliveryDate" IS NOT NULL
        AND "desiredSlotEnd" > "desiredSlotStart"
    )
);

-- §5.1 Payment: the sign of a flow is carried by the entity, never by the
-- number, and the allocated counter can never exceed what was actually paid.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive_check"
    CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_allocated_check"
    CHECK ("amountAllocated" <= "amount");

-- §5.2 Debt: the settled counter can never exceed what is actually due.
ALTER TABLE "debts" ADD CONSTRAINT "debts_amount_settled_check"
    CHECK ("amountSettled" <= "amountDue");

-- §5.3 DebtSettlement: a reversal is identified by a negative allocated
-- amount, and only a reversal may point back at the settlement it reverses.
ALTER TABLE "debt_settlements" ADD CONSTRAINT "debt_settlements_reversal_check"
    CHECK (
        ("reversesSettlementId" IS NOT NULL AND "amountAllocated" < 0)
        OR ("reversesSettlementId" IS NULL AND "amountAllocated" >= 0)
    );

-- §5.3 DebtSettlement rows are "never deleted nor modified" — corrections
-- happen exclusively via a new reversing row. Enforced with a trigger since
-- immutability spans the whole row, not a single column.
CREATE OR REPLACE FUNCTION debt_settlements_forbid_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'debt_settlements rows are immutable — insert a reversing row instead (see §5.3)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER debt_settlements_no_update
    BEFORE UPDATE ON "debt_settlements"
    FOR EACH ROW EXECUTE FUNCTION debt_settlements_forbid_mutation();

CREATE TRIGGER debt_settlements_no_delete
    BEFORE DELETE ON "debt_settlements"
    FOR EACH ROW EXECUTE FUNCTION debt_settlements_forbid_mutation();

-- §5.4 Refund: the flow's direction is carried by the entity, never the sign.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive_check"
    CHECK ("amount" > 0);

-- §7.1 Rating: anti self-review — a person can only be rated if their phone
-- is verified, i.e. they are more than an organization-entered guest record.
-- This spans two tables, so it cannot be a plain column CHECK in Postgres.
CREATE OR REPLACE FUNCTION ratings_require_verified_person()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "people"
        WHERE "id" = NEW."personId" AND "phoneVerifiedAt" IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'ratings.personId must reference a Person with a verified phone number (see §7.1)';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ratings_person_verified
    BEFORE INSERT ON "ratings"
    FOR EACH ROW EXECUTE FUNCTION ratings_require_verified_person();

-- §9.1 Notification: related_entity_type/related_entity_id are set together
-- or not at all.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_entity_check"
    CHECK (
        ("relatedEntityType" IS NULL AND "relatedEntityId" IS NULL)
        OR ("relatedEntityType" IS NOT NULL AND "relatedEntityId" IS NOT NULL)
    );
