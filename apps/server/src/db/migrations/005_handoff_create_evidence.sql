ALTER TABLE command_audit
  ADD COLUMN IF NOT EXISTS create_selection jsonb,
  ADD COLUMN IF NOT EXISTS create_expected_profile_version integer;
