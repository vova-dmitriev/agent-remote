CREATE TABLE IF NOT EXISTS continuity_conversations (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  device_id text NOT NULL,
  active_execution_id uuid,
  version integer NOT NULL CHECK (version > 0),
  updated_at bigint NOT NULL,
  UNIQUE (owner_id, device_id, id),
  FOREIGN KEY (owner_id, device_id) REFERENCES devices(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS execution_links (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  owner_id text NOT NULL,
  device_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('claude', 'codex')),
  profile_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('managed_cli', 'desktop')),
  native_session_id uuid NOT NULL,
  generation uuid NOT NULL,
  created_at bigint NOT NULL,
  UNIQUE (owner_id, device_id, conversation_id, id),
  UNIQUE (owner_id, device_id, provider, native_session_id, generation),
  FOREIGN KEY (owner_id, device_id) REFERENCES devices(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, device_id, conversation_id)
    REFERENCES continuity_conversations(owner_id, device_id, id) ON DELETE CASCADE
);

DO $$ BEGIN
  ALTER TABLE continuity_conversations ADD CONSTRAINT continuity_active_execution_fk
    FOREIGN KEY (owner_id, device_id, id, active_execution_id)
    REFERENCES execution_links(owner_id, device_id, conversation_id, id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS handoff_operations (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  device_id text NOT NULL,
  conversation_id uuid NOT NULL,
  source_execution_id uuid NOT NULL,
  source_generation uuid NOT NULL,
  checkpoint_id uuid NOT NULL,
  checkpoint_digest char(64) NOT NULL CHECK (checkpoint_digest ~ '^[a-f0-9]{64}$'),
  expected_conversation_version integer NOT NULL CHECK (expected_conversation_version > 0),
  expected_profile_version integer NOT NULL CHECK (expected_profile_version > 0),
  target_provider text NOT NULL CHECK (target_provider IN ('claude', 'codex')),
  target_profile_id uuid NOT NULL,
  target_model text NOT NULL CHECK (length(target_model) BETWEEN 1 AND 256),
  target_effort text,
  phase text NOT NULL CHECK (phase IN ('preparing', 'awaiting_source', 'awaiting_auth', 'creating_target', 'delivering_context', 'ready', 'failed', 'unknown')),
  target_execution_id uuid,
  create_command_id uuid NOT NULL UNIQUE,
  seed_command_id uuid NOT NULL UNIQUE,
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  operation_version integer NOT NULL DEFAULT 1 CHECK (operation_version > 0),
  code text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CHECK (id <> create_command_id AND id <> seed_command_id AND create_command_id <> seed_command_id),
  UNIQUE (owner_id, device_id, id),
  UNIQUE (owner_id, device_id, conversation_id, id),
  FOREIGN KEY (owner_id, device_id) REFERENCES devices(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, device_id, conversation_id)
    REFERENCES continuity_conversations(owner_id, device_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, device_id, conversation_id, source_execution_id)
    REFERENCES execution_links(owner_id, device_id, conversation_id, id),
  FOREIGN KEY (owner_id, device_id, conversation_id, target_execution_id)
    REFERENCES execution_links(owner_id, device_id, conversation_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_handoff_per_conversation
  ON handoff_operations(owner_id, device_id, conversation_id)
  WHERE phase NOT IN ('ready', 'failed');

CREATE TABLE IF NOT EXISTS handoff_command_ids (
  command_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  device_id text NOT NULL,
  operation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('operation', 'create', 'seed')),
  UNIQUE (owner_id, device_id, operation_id, kind),
  FOREIGN KEY (owner_id, device_id) REFERENCES devices(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, device_id, operation_id)
    REFERENCES handoff_operations(owner_id, device_id, id) ON DELETE CASCADE
);
