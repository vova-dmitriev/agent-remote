CREATE TABLE IF NOT EXISTS telegram_actions (
  token text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  session_id text NOT NULL,
  request_id text NOT NULL,
  generation text NOT NULL,
  expires_at bigint NOT NULL
);
