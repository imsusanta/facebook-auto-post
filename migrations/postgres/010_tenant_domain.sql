-- Gate 2: Tenant-scoped business domain tables
-- Enforces workspace_id containment and composite tenant-safe constraints.

CREATE TABLE workspace_pages (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id VARCHAR(100) NOT NULL,
  page_name VARCHAR(255) NOT NULL,
  access_token_encrypted TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'revoked')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  category VARCHAR(100) DEFAULT 'General',
  system_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT workspace_pages_unique UNIQUE (workspace_id, page_id)
);
CREATE INDEX workspace_pages_workspace ON workspace_pages(workspace_id, status) WHERE deleted_at IS NULL;

CREATE TABLE workspace_posts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'review_required')),
  category VARCHAR(100),
  topic VARCHAR(255),
  caption TEXT NOT NULL,
  media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  fb_post_id VARCHAR(100),
  error_message TEXT,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX workspace_posts_workspace ON workspace_posts(workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX workspace_posts_schedule ON workspace_posts(workspace_id, scheduled_at) WHERE status = 'scheduled' AND deleted_at IS NULL;

CREATE TABLE workspace_post_versions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES workspace_posts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  caption TEXT NOT NULL,
  media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_post_versions_unique UNIQUE (workspace_id, post_id, version_number)
);
CREATE INDEX workspace_post_versions_idx ON workspace_post_versions(workspace_id, post_id, version_number);

CREATE TABLE workspace_schedules (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id VARCHAR(100),
  cron_expression VARCHAR(100) NOT NULL,
  cron_label VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  selected_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  include_ai_image BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX workspace_schedules_workspace ON workspace_schedules(workspace_id, status);

CREATE TABLE workspace_templates (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  badge VARCHAR(100),
  category VARCHAR(100),
  description TEXT,
  sample TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_templates_unique UNIQUE (workspace_id, slug)
);
CREATE INDEX workspace_templates_workspace ON workspace_templates(workspace_id);

CREATE TABLE workspace_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_media (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX workspace_media_workspace ON workspace_media(workspace_id) WHERE deleted_at IS NULL;
