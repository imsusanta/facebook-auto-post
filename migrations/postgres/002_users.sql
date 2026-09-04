-- Migration 002: Users Table
-- Supports normalized email uniqueness, versioned password hash abstraction, and soft-delete.

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    email_normalized VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    password_algorithm VARCHAR(32) NOT NULL DEFAULT 'pbkdf2_sha512',
    password_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    email_verified_at TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_users_email_normalized UNIQUE (email_normalized),
    CONSTRAINT chk_users_status CHECK (status IN ('active', 'suspended', 'pending_verification'))
);

CREATE INDEX idx_users_email_normalized ON users(email_normalized);
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;
