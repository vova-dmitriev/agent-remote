CREATE TABLE IF NOT EXISTS client_links (
  code_hash text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS client_links_expiry ON client_links (expires_at);
