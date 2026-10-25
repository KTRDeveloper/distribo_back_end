-- CreateEnum
CREATE TYPE "SubscriptionEventKind" AS ENUM (
    'PAYMENT', 'FORFAIT_ADDED', 'FORFAIT_ENDED', 'PLAN_CHANGED', 'REMINDER',
    'KEEP_CHOICE', 'PAUSED', 'RESUMED'
);
CREATE TYPE "SubscriptionEventActor" AS ENUM ('PAYER', 'OWNER', 'SYSTEM', 'ADMINISTRATOR');

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "SubscriptionEventKind" NOT NULL,
    "actor" "SubscriptionEventActor" NOT NULL,
    "person_id" UUID,
    "administrator_id" UUID,
    "admin_action_id" UUID,
    "subscription_id" UUID,
    "payment_id" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id"),
    -- A person is named exactly when the owner caused the event (C-55).
    CONSTRAINT "subscription_events_person_matches_actor"
        CHECK (("person_id" IS NOT NULL) = ("actor" = 'OWNER')),
    -- An administrator and an admin action are named exactly when an administrator
    -- caused the event (C-55).
    CONSTRAINT "subscription_events_administrator_matches_actor"
        CHECK (("administrator_id" IS NOT NULL) = ("actor" = 'ADMINISTRATOR')
               AND ("admin_action_id" IS NOT NULL) = ("actor" = 'ADMINISTRATOR')),
    -- A payment is named whenever the payer caused the event (C-55).
    CONSTRAINT "subscription_events_payment_for_payer"
        CHECK ("actor" <> 'PAYER' OR "payment_id" IS NOT NULL),
    -- The details are a JSON object, never a list, a scalar or JSON null.
    CONSTRAINT "subscription_events_details_is_object"
        CHECK (jsonb_typeof("details") = 'object')
);

-- CreateIndex
CREATE INDEX "subscription_events_organization_id_occurred_at_idx"
    ON "subscription_events"("organization_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "subscription_events"
    ADD CONSTRAINT "subscription_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_events"
    ADD CONSTRAINT "subscription_events_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "people"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_events"
    ADD CONSTRAINT "subscription_events_administrator_id_fkey"
    FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_events"
    ADD CONSTRAINT "subscription_events_admin_action_id_fkey"
    FOREIGN KEY ("admin_action_id") REFERENCES "admin_actions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_events"
    ADD CONSTRAINT "subscription_events_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_events"
    ADD CONSTRAINT "subscription_events_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The journal is append-only: the application account has only INSERT and SELECT (C-39).
REVOKE ALL ON TABLE "subscription_events" FROM distribo_app;
GRANT SELECT, INSERT ON TABLE "subscription_events" TO distribo_app;
