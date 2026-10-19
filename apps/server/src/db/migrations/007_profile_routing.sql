CREATE TABLE profile_routing_settings (
  owner_id text NOT NULL,
  device_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  data jsonb NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (owner_id, device_id),
  FOREIGN KEY (owner_id, device_id) REFERENCES devices(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE profile_quota_observations (
  owner_id text NOT NULL,
  device_id text NOT NULL,
  profile_id uuid NOT NULL,
  scope_key text NOT NULL,
  observed_at bigint NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (owner_id, device_id, profile_id, scope_key),
  FOREIGN KEY (owner_id, device_id) REFERENCES devices(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX profile_quota_observations_latest
  ON profile_quota_observations(owner_id, device_id, observed_at DESC);
