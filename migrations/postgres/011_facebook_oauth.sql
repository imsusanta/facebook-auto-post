-- Gate 4: Facebook/Meta OAuth integration tables
-- Token vault, OAuth state management, and webhook routing.

-- Encrypted token storage bound to workspace pages
CREATE TABLE workspace_page_tokens (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_page_id UUID NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE,
  token_encrypted TEXT NOT NULL,
  token_type VARCHAR(50) NOT NULL DEFAULT 'page_access_token'
    CHECK (token_type IN ('page_access_token', 'user_access_token')),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX workspace_page_tokens_active
  ON workspace_page_tokens(workspace_page_id, token_type)
  WHERE revoked_at IS NULL;
CREATE INDEX workspace_page_tokens_workspace
  ON workspace_page_tokens(workspace_id) WHERE revoked_at IS NULL;
CREATE INDEX workspace_page_tokens_expiry
  ON workspace_page_tokens(expires_at) WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

-- OAuth CSRF state tracking (short-lived, single-use)
CREATE TABLE workspace_oauth_states (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_hash VARCHAR(128) NOT NULL UNIQUE,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX workspace_oauth_states_expiry
  ON workspace_oauth_states(expires_at) WHERE consumed_at IS NULL;

-- Webhook subscription routing (page_id → workspace_id)
CREATE TABLE workspace_webhook_subscriptions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id VARCHAR(100) NOT NULL,
  subscription_id VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_webhook_subs_unique UNIQUE (workspace_id, page_id)
);
CREATE INDEX workspace_webhook_subs_page
  ON workspace_webhook_subscriptions(page_id, status) WHERE status = 'active';

-- Webhook event deduplication ledger
CREATE TABLE workspace_webhook_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_webhook_events_unique UNIQUE (page_id, event_id)
);
CREATE INDEX workspace_webhook_events_workspace
  ON workspace_webhook_events(workspace_id, received_at);
