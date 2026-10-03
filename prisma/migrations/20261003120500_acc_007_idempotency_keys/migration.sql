CREATE TABLE "idempotency_keys" (
    "person_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "status_code" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("person_id", "key"),
    CONSTRAINT "idempotency_keys_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
