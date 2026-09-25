-- WZ MANAGE PRO V11 — Admin Platform V1
-- Non-destructive additive migration. Run against the existing database.
-- No existing tenant, user, subscription, payment, or forum data is deleted.

CREATE TABLE IF NOT EXISTS wz_platform_admins(
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wz_platform_admin_sessions(
  token_hash TEXT PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES wz_platform_admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wz_platform_admin_sessions_exp_idx ON wz_platform_admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS wz_admin_audit_logs(
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT REFERENCES wz_platform_admins(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  business_id TEXT REFERENCES wz_businesses(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wz_admin_audit_logs_created_idx ON wz_admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS wz_admin_audit_logs_business_idx ON wz_admin_audit_logs(business_id,created_at DESC);

CREATE TABLE IF NOT EXISTS wz_admin_notifications(
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  business_id TEXT REFERENCES wz_businesses(id) ON DELETE CASCADE,
  target_type TEXT,
  target_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wz_admin_notifications_created_idx ON wz_admin_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS wz_admin_notifications_business_idx ON wz_admin_notifications(business_id,created_at DESC);

CREATE TABLE IF NOT EXISTS wz_system_settings(
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by BIGINT REFERENCES wz_platform_admins(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add tenant and admin sender metadata to the existing Owner Forum.
ALTER TABLE wz_owner_forum_messages ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES wz_businesses(id);
ALTER TABLE wz_owner_forum_messages ADD COLUMN IF NOT EXISTS sender_admin_id BIGINT REFERENCES wz_platform_admins(id) ON DELETE SET NULL;
ALTER TABLE wz_owner_forum_messages ADD COLUMN IF NOT EXISTS sender_role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE wz_owner_forum_messages ALTER COLUMN sender_user_id DROP NOT NULL;

-- Preserve existing forum rows by assigning the tenant from their original user.
UPDATE wz_owner_forum_messages m
SET business_id=u.business_id
FROM wz_users u
WHERE m.business_id IS NULL AND m.sender_user_id=u.id;

CREATE INDEX IF NOT EXISTS wz_owner_forum_messages_business_created_idx
  ON wz_owner_forum_messages(business_id,created_at DESC);

CREATE TABLE IF NOT EXISTS wz_admin_forum_reads(
  admin_id BIGINT NOT NULL REFERENCES wz_platform_admins(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES wz_businesses(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(admin_id,business_id)
);
