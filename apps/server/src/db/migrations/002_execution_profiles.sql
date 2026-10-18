CREATE TABLE IF NOT EXISTS execution_profile_metadata (
  owner_id text NOT NULL,
  device_id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (owner_id, device_id),
  FOREIGN KEY (owner_id, device_id) REFERENCES devices(owner_id, id) ON DELETE CASCADE
);
