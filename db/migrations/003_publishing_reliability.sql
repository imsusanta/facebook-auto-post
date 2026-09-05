ALTER TABLE scheduled_posts DROP CONSTRAINT scheduled_status_valid;
ALTER TABLE scheduled_posts ADD CONSTRAINT scheduled_status_valid CHECK(status IN ('pending','processing','completed','failed','needs_review','retry_wait')),
 ADD COLUMN kind text NOT NULL DEFAULT 'publish' CHECK(kind IN ('publish','autopilot')),
 ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 ADD COLUMN max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 10),
 ADD COLUMN next_attempt_at timestamptz,
 ADD COLUMN lease_owner uuid, ADD COLUMN lease_expires_at timestamptz, ADD COLUMN dispatch_started_at timestamptz,
 ADD COLUMN last_error_code text, ADD COLUMN last_error_message text,
 ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';
-- An old in-flight request may already have reached Facebook. Never blindly reclaim it.
UPDATE scheduled_posts SET status='needs_review',data=jsonb_set(data,'{status}','"needs_review"'),
 last_error_code='LEGACY_IN_FLIGHT',last_error_message='Check Facebook before creating another publication' WHERE status='processing';
CREATE INDEX publication_retry_due ON scheduled_posts(workspace_id,next_attempt_at,scheduled_at) WHERE status IN ('pending','retry_wait');
CREATE INDEX publication_expired_lease ON scheduled_posts(lease_expires_at) WHERE status='processing';
CREATE TABLE publication_intents (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 operation_key text NOT NULL, payload_hash text NOT NULL, job_id text,
 receipt jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,operation_key),
 FOREIGN KEY(workspace_id,job_id) REFERENCES scheduled_posts(workspace_id,id) ON DELETE SET NULL(job_id)
);
CREATE TABLE publication_attempts (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, job_id text NOT NULL, lease_owner uuid NOT NULL,
 attempt_number integer NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 outcome text, error_code text, provider_result jsonb, PRIMARY KEY(workspace_id,job_id,lease_owner),
 FOREIGN KEY(workspace_id,job_id) REFERENCES scheduled_posts(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE autopilot_schedules (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, facebook_page_id text NOT NULL,
 cron_expression text NOT NULL, time_zone text NOT NULL, next_run_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY(workspace_id,facebook_page_id) REFERENCES facebook_pages(workspace_id,id)
);
CREATE INDEX autopilot_due ON autopilot_schedules(next_run_at) WHERE enabled;
ALTER TABLE media_assets ADD COLUMN content_sha256 text;
ALTER TABLE post_history ADD COLUMN job_id text,
 ADD CONSTRAINT history_job_owner FOREIGN KEY(workspace_id,job_id) REFERENCES scheduled_posts(workspace_id,id) ON DELETE SET NULL(job_id),
 ADD CONSTRAINT history_job_once UNIQUE(workspace_id,job_id);
