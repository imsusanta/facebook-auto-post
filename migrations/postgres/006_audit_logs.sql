-- Migration 006: Audit Logs Table
-- Stores tenant-scoped, append-only security and operational audit records.
-- All queries and reads must be scoped to workspace_id.

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(128) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(128),
    outcome VARCHAR(32) NOT NULL DEFAULT 'success',
    request_id VARCHAR(64),
    ip_hash VARCHAR(64),
    user_agent_summary VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_audit_outcome CHECK (outcome IN ('success', 'failure', 'denied', 'error'))
);

CREATE INDEX idx_audit_logs_workspace_created ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX idx_audit_logs_workspace_resource ON audit_logs(workspace_id, resource_type, resource_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id);
