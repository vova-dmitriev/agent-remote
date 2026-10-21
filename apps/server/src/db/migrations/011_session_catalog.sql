CREATE TABLE IF NOT EXISTS session_catalog (
  owner_id text NOT NULL,
  device_id text NOT NULL,
  id text NOT NULL,
  device_generation text,
  provider text NOT NULL,
  recency_at bigint NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (owner_id, device_id, id),
  FOREIGN KEY (owner_id, device_id) REFERENCES devices(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_catalog_page
  ON session_catalog (owner_id, device_id, provider, recency_at DESC, id ASC);
