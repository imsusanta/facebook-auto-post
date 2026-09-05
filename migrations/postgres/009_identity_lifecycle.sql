-- Additive account lifecycle and durable, encrypted test-mail delivery state.
ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0 CHECK (auth_version >= 0);
ALTER TABLE auth_sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0 CHECK (auth_version >= 0);
CREATE TABLE auth_action_tokens (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  auth_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX auth_action_tokens_one_live ON auth_action_tokens(user_id, purpose)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE TABLE auth_mail_outbox (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL REFERENCES auth_action_tokens(token_hash) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'cancelled')),
  payload TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX auth_mail_pending ON auth_mail_outbox(available_at) WHERE state = 'pending';
CREATE TABLE account_security_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN (
    'account.registered', 'verification.requested', 'email.verified',
    'recovery.requested', 'password.reset', 'password.changed',
    'sessions.revoked', 'account.suspended', 'account.deleted',
    'password.hash_upgraded', 'session.created')),
  auth_version INTEGER NOT NULL,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX account_security_events_user ON account_security_events(user_id, created_at);
CREATE TABLE auth_rate_buckets (
  bucket_key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL CHECK (hits > 0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_rate_buckets_expiry ON auth_rate_buckets(expires_at);
