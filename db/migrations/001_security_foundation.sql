CREATE TABLE users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
 password_hash text NOT NULL, email_verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspaces (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE workspace_members (
 workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('owner','editor','viewer')), PRIMARY KEY(workspace_id,user_id)
);
CREATE INDEX workspace_members_user ON workspace_members(user_id);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, csrf_token text NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL,
 FOREIGN KEY (workspace_id,user_id) REFERENCES workspace_members(workspace_id,user_id) ON DELETE CASCADE
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE auth_tokens (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK (purpose IN ('verify','reset')), expires_at timestamptz NOT NULL
);
CREATE INDEX auth_tokens_expiry ON auth_tokens(expires_at);
CREATE TABLE rate_limits (key text PRIMARY KEY, hits integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
CREATE TABLE workspace_settings (workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, data jsonb NOT NULL DEFAULT '{}');
CREATE TABLE automation_rules (workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, data jsonb NOT NULL DEFAULT '{}');
CREATE TABLE facebook_pages (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, id text NOT NULL,
 data jsonb NOT NULL, PRIMARY KEY(workspace_id,id), UNIQUE(id)
);
CREATE TABLE scheduled_posts (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, id text NOT NULL,
 facebook_page_id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,facebook_page_id) REFERENCES facebook_pages(workspace_id,id)
);
CREATE INDEX scheduled_posts_status ON scheduled_posts(workspace_id, (data->>'status'));
CREATE TABLE post_history (workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(workspace_id,id));
CREATE TABLE templates (workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(workspace_id,id));
CREATE TABLE categories (workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(workspace_id,id));
CREATE TABLE media_assets (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, id text NOT NULL,
 filename text NOT NULL, content_type text NOT NULL, size bigint NOT NULL CHECK(size > 0),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,filename)
);
CREATE TABLE webhook_events (
 id text PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 data jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), error text
);
CREATE INDEX webhook_events_status ON webhook_events(status,created_at);
CREATE TABLE audit_logs (
 id bigserial PRIMARY KEY, workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
