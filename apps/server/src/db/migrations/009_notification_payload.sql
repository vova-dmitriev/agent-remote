ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS payload jsonb;
