-- Gate 5: Durable publishing pipeline, transactional outbox, and idempotency ledger
-- Enforces PostgreSQL-native queueing (FOR UPDATE SKIP LOCKED) and secret redaction.

CREATE TABLE workspace_publish_jobs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES workspace_posts(id) ON DELETE CASCADE,
  workspace_page_id UUID REFERENCES workspace_pages(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'locked', 'publishing', 'published', 'failed', 'cancelled', 'dead_letter')),
  idempotency_key VARCHAR(255) NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(100),
  error_code VARCHAR(100),
  error_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_publish_jobs_idempotency_unique UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX workspace_publish_jobs_poll
  ON workspace_publish_jobs(status, next_run_at)
  WHERE status = 'queued';

CREATE INDEX workspace_publish_jobs_workspace
  ON workspace_publish_jobs(workspace_id, status);

CREATE INDEX workspace_publish_jobs_stale
  ON workspace_publish_jobs(status, locked_at)
  WHERE status IN ('locked', 'publishing');

CREATE INDEX workspace_publish_jobs_post
  ON workspace_publish_jobs(workspace_id, post_id);

CREATE TABLE workspace_publish_attempts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES workspace_publish_jobs(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES workspace_posts(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  status VARCHAR(50) NOT NULL
    CHECK (status IN ('success', 'failed', 'ambiguous')),
  request_hash VARCHAR(64) NOT NULL,
  fb_post_id VARCHAR(100),
  error_code VARCHAR(100),
  error_message TEXT,
  duration_ms INT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX workspace_publish_attempts_job
  ON workspace_publish_attempts(workspace_id, job_id, attempt_number);

CREATE INDEX workspace_publish_attempts_workspace
  ON workspace_publish_attempts(workspace_id, started_at);

CREATE TABLE workspace_publish_idempotency (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(255) NOT NULL,
  post_id UUID NOT NULL REFERENCES workspace_posts(id) ON DELETE CASCADE,
  fb_post_id VARCHAR(100),
  status VARCHAR(50) NOT NULL
    CHECK (status IN ('in_flight', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_publish_idempotency_unique UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX workspace_publish_idempotency_post
  ON workspace_publish_idempotency(workspace_id, post_id);
