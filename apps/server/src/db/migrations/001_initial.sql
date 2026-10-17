CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, telegram_id text NOT NULL UNIQUE, created_at bigint NOT NULL, private_chat_id text, notifications_enabled boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS auth_sessions (token_hash text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS devices (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id), token_hash text NOT NULL UNIQUE, generation text NOT NULL, revoked_at bigint, last_seen_at bigint NOT NULL DEFAULT 0, snapshot jsonb, connectors jsonb NOT NULL DEFAULT '[]', UNIQUE(owner_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS one_active_device ON devices(owner_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS pairings (code_hash text PRIMARY KEY, proof_hash text NOT NULL UNIQUE, expires_at bigint NOT NULL, claim_id text UNIQUE, owner_id text REFERENCES users(id), consumed boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS sessions (owner_id text NOT NULL, device_id text NOT NULL, id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(owner_id,device_id,id), FOREIGN KEY(owner_id,device_id) REFERENCES devices(owner_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS events (owner_id text NOT NULL, device_id text NOT NULL, stream_id text NOT NULL, seq bigint NOT NULL, event_id text NOT NULL, session_id text, occurred_at bigint NOT NULL, data jsonb NOT NULL, PRIMARY KEY(owner_id,device_id,stream_id,seq), UNIQUE(owner_id,device_id,event_id), FOREIGN KEY(owner_id,device_id) REFERENCES devices(owner_id,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS events_retention ON events(device_id,occurred_at);
CREATE TABLE IF NOT EXISTS command_audit (owner_id text NOT NULL, command_id text NOT NULL, device_id text NOT NULL, session_id text NOT NULL, action text NOT NULL, fingerprint text NOT NULL, status text NOT NULL, code text, created_at bigint NOT NULL, PRIMARY KEY(owner_id,command_id), FOREIGN KEY(owner_id,device_id) REFERENCES devices(owner_id,id));
CREATE TABLE IF NOT EXISTS notification_outbox (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id), session_id text, kind text NOT NULL, created_at bigint NOT NULL, next_attempt_at bigint NOT NULL, attempts integer NOT NULL DEFAULT 0, sent boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS bot_state (key text PRIMARY KEY,value text NOT NULL);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS history_revision bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS session_history_page ON events(owner_id,device_id,session_id,occurred_at DESC,event_id DESC);
CREATE INDEX IF NOT EXISTS session_history_ordered_page ON events(owner_id,device_id,session_id,occurred_at DESC,stream_id DESC,seq DESC,event_id DESC);
CREATE TABLE IF NOT EXISTS attachments (owner_id text NOT NULL, device_id text NOT NULL, session_id text NOT NULL, id text NOT NULL, descriptor jsonb NOT NULL, bytes bytea NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,device_id) REFERENCES devices(owner_id,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS attachments_expiry ON attachments(expires_at);
CREATE INDEX IF NOT EXISTS attachments_session ON attachments(owner_id,device_id,session_id);
CREATE TABLE IF NOT EXISTS user_preferences (owner_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, language text CHECK (language IN ('ru','en')), theme text CHECK (theme IN ('auto','light','dark')));

ALTER TABLE command_audit ADD COLUMN IF NOT EXISTS result_session_id TEXT;

CREATE TABLE IF NOT EXISTS session_labels (owner_id text NOT NULL, device_id text NOT NULL, source_key text NOT NULL, title text NOT NULL, PRIMARY KEY(owner_id,device_id,source_key), FOREIGN KEY(owner_id,device_id) REFERENCES devices(owner_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS session_activity (owner_id text NOT NULL, device_id text NOT NULL, session_id text NOT NULL, last_message_at bigint NOT NULL, PRIMARY KEY(owner_id,device_id,session_id), FOREIGN KEY(owner_id,device_id) REFERENCES devices(owner_id,id) ON DELETE CASCADE);
INSERT INTO session_activity(owner_id,device_id,session_id,last_message_at)
SELECT owner_id,device_id,session_id,max((data->'payload'->>'occurredAt')::bigint) FROM events
WHERE session_id IS NOT NULL AND data->>'type'='message' AND (data->'payload'->>'occurredAt') ~ '^[0-9]{1,15}$'
GROUP BY owner_id,device_id,session_id
ON CONFLICT(owner_id,device_id,session_id) DO UPDATE SET last_message_at=greatest(session_activity.last_message_at,EXCLUDED.last_message_at);

CREATE TABLE IF NOT EXISTS browser_sessions (token_hash text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at bigint NOT NULL);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS browser_session_hash text REFERENCES browser_sessions(token_hash) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS browser_sessions_expiry ON browser_sessions(expires_at);
CREATE INDEX IF NOT EXISTS auth_browser_session ON auth_sessions(browser_session_hash);

CREATE TABLE IF NOT EXISTS attachment_blobs(owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,sha256 text NOT NULL,bytes bytea NOT NULL,PRIMARY KEY(owner_id,sha256));
ALTER TABLE attachments ALTER COLUMN bytes DROP NOT NULL;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS blob_sha256 text;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS device_export boolean NOT NULL DEFAULT false;
INSERT INTO attachment_blobs(owner_id,sha256,bytes)
SELECT DISTINCT ON(owner_id,descriptor->>'sha256') owner_id,descriptor->>'sha256',bytes FROM attachments
WHERE bytes IS NOT NULL AND substring(id,15,1)='5' AND (descriptor->>'sha256') ~ '^[a-f0-9]{64}$'
ON CONFLICT(owner_id,sha256) DO NOTHING;
UPDATE attachments a SET blob_sha256=a.descriptor->>'sha256',bytes=NULL
WHERE a.bytes IS NOT NULL AND substring(a.id,15,1)='5' AND EXISTS(SELECT 1 FROM attachment_blobs b WHERE b.owner_id=a.owner_id AND b.sha256=a.descriptor->>'sha256');
CREATE INDEX IF NOT EXISTS attachment_blob_references ON attachments(owner_id,blob_sha256);

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS source_message_id text;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS source_position text;

CREATE TABLE IF NOT EXISTS reading_positions (
  owner_id text NOT NULL, device_id text NOT NULL, session_id text NOT NULL,
  message_id text NOT NULL, pixel_offset double precision NOT NULL, cursor text, updated_at bigint NOT NULL,
  PRIMARY KEY(owner_id,device_id,session_id),
  FOREIGN KEY(owner_id,device_id) REFERENCES devices(owner_id,id) ON DELETE CASCADE
);
