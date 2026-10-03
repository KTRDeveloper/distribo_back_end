ALTER TABLE "notifications"
ADD CONSTRAINT "notifications_content_check" CHECK (
  char_length("content") <= 2000 AND btrim("content") <> ''
),
ADD CONSTRAINT "notifications_source_event_check" CHECK (
  char_length("source_event") <= 100
  AND "source_event" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
),
ADD CONSTRAINT "notifications_related_entity_type_check" CHECK (
  "related_entity_type" IS NULL
  OR (char_length("related_entity_type") <= 100 AND btrim("related_entity_type") <> '')
);
