CREATE TABLE IF NOT EXISTS command_id_claims (
  command_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  device_id text NOT NULL,
  operation_id uuid,
  kind text NOT NULL CHECK (kind IN ('command', 'handoff_operation', 'handoff_create', 'handoff_seed')),
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  created_at bigint NOT NULL,
  FOREIGN KEY (owner_id, device_id) REFERENCES devices(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, device_id, operation_id)
    REFERENCES handoff_operations(owner_id, device_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CHECK ((kind = 'command' AND operation_id IS NULL) OR (kind <> 'command' AND operation_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS command_id_claims_device ON command_id_claims(owner_id, device_id);

CREATE TABLE IF NOT EXISTS handoff_seed_proofs (
  operation_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  device_id text NOT NULL,
  conversation_id uuid NOT NULL,
  device_generation uuid NOT NULL,
  seed_command_id uuid NOT NULL UNIQUE,
  checkpoint_id uuid NOT NULL,
  checkpoint_digest char(64) NOT NULL CHECK (checkpoint_digest ~ '^[a-f0-9]{64}$'),
  target_execution_id uuid NOT NULL,
  target_generation uuid NOT NULL,
  target_profile_id uuid NOT NULL,
  target_provider text NOT NULL CHECK (target_provider IN ('claude', 'codex')),
  target_model text NOT NULL CHECK (length(target_model) BETWEEN 1 AND 256),
  target_effort text,
  received_at bigint NOT NULL,
  FOREIGN KEY (owner_id, device_id, conversation_id, operation_id)
    REFERENCES handoff_operations(owner_id, device_id, conversation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (seed_command_id) REFERENCES handoff_operations(seed_command_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, device_id, conversation_id, target_execution_id)
    REFERENCES execution_links(owner_id, device_id, conversation_id, id) ON DELETE CASCADE
);
