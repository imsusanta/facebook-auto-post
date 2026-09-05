-- Migration 005: Workspace Invitations Table
-- Stores invitation metadata with secure SHA-256 token hashing.
-- Invitations cannot grant the 'owner' role.
-- Deleting an inviter retains invitation history for audit (invited_by ON DELETE SET NULL).

CREATE TABLE workspace_invitations (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email_normalized VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_invitations_token_hash UNIQUE (token_hash),
    CONSTRAINT chk_invitations_role CHECK (role IN ('admin', 'editor', 'reviewer', 'viewer')),
    CONSTRAINT chk_invitations_status CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);

CREATE INDEX idx_invitations_workspace ON workspace_invitations(workspace_id);
CREATE INDEX idx_invitations_email ON workspace_invitations(email_normalized);
CREATE UNIQUE INDEX uq_invitations_active ON workspace_invitations(workspace_id, email_normalized) WHERE status = 'pending';
