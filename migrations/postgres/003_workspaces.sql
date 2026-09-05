-- Migration 003: Workspaces Table
-- Defines tenant organizational boundaries with unique slugs and status checks.

CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_workspaces_slug UNIQUE (slug),
    CONSTRAINT chk_workspaces_status CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'deleted'))
);

CREATE INDEX idx_workspaces_slug ON workspaces(slug);
CREATE INDEX idx_workspaces_created_by ON workspaces(created_by);
