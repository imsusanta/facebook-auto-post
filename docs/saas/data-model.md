# SaaS Relational Data Model (PostgreSQL 16)

## 1. Executive Summary

This document specifies the target relational schema, table structures, column definitions, composite tenant constraints, foreign keys, indexes, deletion policies, and audit requirements for the multi-tenant Bengali-first Facebook Auto-Poster SaaS.

```
+-----------------------------------------------------------------------------+
|                             Data Model Status                               |
+--------------------------+--------------------------------------------------+
| CURRENT (Single-Tenant)  | Flat JSON files in data/, unimported SQLite      |
|                          | in services/db.js, PBKDF2-HMAC-SHA512 hashes     |
+--------------------------+--------------------------------------------------+
| TARGET (Multi-Tenant)    | PostgreSQL 16, UUIDv7 primary keys, composite    |
|                          | tenant keys (workspace_id, id), versioned hashes |
|                          | (Argon2id), envelope encryption for secrets      |
+--------------------------+--------------------------------------------------+
| DEFERRED                 | Horizontal database sharding, Citus clustering   |
+--------------------------+--------------------------------------------------+
```

---

## 2. Core Relational Architecture Principles

1. **UUIDv7 Identifiers**: All primary keys utilize time-sortable UUIDv7 identifiers to prevent enumeration attacks and ensure efficient B-tree index locality.
2. **Tenant Scoping**: Every tenant-owned table contains a non-nullable `workspace_id` referencing `workspaces(id)`.
3. **Composite Foreign Keys for Cross-Table Tenant Integrity**:
   A globally unique UUID primary key alone does not prevent a rogue client from linking a Child record in Tenant A to a Parent record in Tenant B if the child only references `parent_id`. To guarantee database-level tenant isolation, tables define a composite unique constraint `UNIQUE (workspace_id, id)` and child tables enforce composite foreign keys:
   `FOREIGN KEY (workspace_id, parent_id) REFERENCES parent_table(workspace_id, id) ON DELETE CASCADE`.
4. **No Secrets in Plaintext**: All external Facebook tokens and API keys are stored in encrypted envelope format (AES-256-GCM + KMS).
5. **No Facebook Page ID as Primary Key**: Meta Page IDs are stored as attributes (`facebook_page_id VARCHAR(64)`), never as internal primary keys.

---

## 3. Identity & Workspace Domain

### Table: `users`
Represents individual human users across all workspaces.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, -- Versioned format: Argon2id or legacy PBKDF2 prefix
    full_name VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active', -- 'active', 'suspended', 'pending_verification'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
```
- **Password Hash Format**:
  - Legacy migrated hashes: `pbkdf2_sha512$100000$<salt>$<hash>` (100k iterations, 16-byte salt).
  - Target hashes: `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>` (auto-rehashed upon successful login).

### Table: `workspaces`
Represents isolated tenant boundaries.

```sql
CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(64) NOT NULL UNIQUE,
    plan_tier VARCHAR(32) NOT NULL DEFAULT 'starter', -- 'starter', 'pro', 'agency'
    status VARCHAR(32) NOT NULL DEFAULT 'active',    -- 'trialing', 'active', 'past_due', 'paused', 'deleted'
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspaces_slug ON workspaces(slug);
```

### Table: `workspace_members`
Maps users to workspaces with canonical RBAC roles.

```sql
CREATE TABLE workspace_members (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL, -- 'owner', 'admin', 'editor', 'reviewer', 'viewer'
    status VARCHAR(32) NOT NULL DEFAULT 'active', -- 'active', 'suspended', 'removed'
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workspace_members_user UNIQUE (workspace_id, user_id),
    CONSTRAINT uq_workspace_members_composite UNIQUE (workspace_id, id)
);

CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);
```

### Table: `workspace_invitations`
```sql
CREATE TABLE workspace_invitations (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    invited_by UUID NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_workspace ON workspace_invitations(workspace_id);
```

---

## 4. Facebook & Page DNA Domain

### Table: `facebook_connections`
Represents a user's authenticated Meta OAuth session.

```sql
CREATE TABLE facebook_connections (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    facebook_user_id VARCHAR(64) NOT NULL,
    encrypted_user_token BYTEA NOT NULL,
    encrypted_dek BYTEA NOT NULL,
    iv BYTEA NOT NULL,
    auth_tag BYTEA NOT NULL,
    key_version VARCHAR(32) NOT NULL,
    scopes TEXT[] NOT NULL,
    token_expires_at TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'active', -- 'active', 'expired', 'revoked'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fb_connections_composite UNIQUE (workspace_id, id)
);
```

### Table: `facebook_pages`
Represents a Facebook Page connected to a workspace (strict 1:1 ownership).

```sql
CREATE TABLE facebook_pages (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL,
    facebook_page_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(128),
    picture_url TEXT,
    encrypted_page_token BYTEA NOT NULL,
    encrypted_dek BYTEA NOT NULL,
    iv BYTEA NOT NULL,
    auth_tag BYTEA NOT NULL,
    key_version VARCHAR(32) NOT NULL,
    tasks TEXT[] NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active', -- 'active', 'token_expired', 'permission_lost', 'disconnected'
    token_last_verified_at TIMESTAMPTZ,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fb_pages_composite UNIQUE (workspace_id, id),
    CONSTRAINT fk_fb_pages_connection
        FOREIGN KEY (workspace_id, connection_id)
        REFERENCES facebook_connections(workspace_id, id)
        ON DELETE CASCADE
);

-- Strict 1:1 Page Ownership Constraint
CREATE UNIQUE INDEX idx_unique_active_facebook_page
ON facebook_pages (facebook_page_id)
WHERE status != 'disconnected';

CREATE INDEX idx_fb_pages_workspace ON facebook_pages(workspace_id);
```

### Table: `page_dna_profiles`
Maintains Bengali brand voice and content persona for a connected Facebook Page.

```sql
CREATE TABLE page_dna_profiles (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    facebook_page_id UUID NOT NULL,
    brand_name VARCHAR(128) NOT NULL,
    niche VARCHAR(64) NOT NULL,
    primary_goal VARCHAR(32) NOT NULL, -- Enum: 'community_growth', 'product_sales', 'traffic'
    tone VARCHAR(32) NOT NULL,         -- Enum: 'authentic_storytelling', 'friendly_peer', 'authoritative_expert'
    audience_knowledge_level VARCHAR(32) NOT NULL, -- Enum: 'beginner_curious', 'informed_general', 'intermediate_practitioner'
    language VARCHAR(16) NOT NULL DEFAULT 'bn',    -- 'bn', 'bn_en_mixed'
    banned_words TEXT[],
    sample_hook TEXT,
    cta_style VARCHAR(32) NOT NULL,
    hashtag_style VARCHAR(32) NOT NULL,
    approval_mode VARCHAR(32) NOT NULL DEFAULT 'always_require_review', -- 'always_require_review', 'auto_publish_low_risk'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_page_dna_page UNIQUE (workspace_id, facebook_page_id),
    CONSTRAINT uq_page_dna_composite UNIQUE (workspace_id, id),
    CONSTRAINT fk_page_dna_page
        FOREIGN KEY (workspace_id, facebook_page_id)
        REFERENCES facebook_pages(workspace_id, id)
        ON DELETE CASCADE
);
```

### Table: `page_dna_versions`
Audit snapshots of Page DNA changes.

```sql
CREATE TABLE page_dna_versions (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL,
    version_number INT NOT NULL,
    snapshot JSONB NOT NULL,
    change_summary TEXT,
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_dna_versions_parent
        FOREIGN KEY (workspace_id, profile_id)
        REFERENCES page_dna_profiles(workspace_id, id)
        ON DELETE CASCADE
);
```

---

## 5. Content, Scheduling, and Telemetry Domain

### Table: `content_posts`
Represents post conceptual entities.

```sql
CREATE TABLE content_posts (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    facebook_page_id UUID NOT NULL,
    category VARCHAR(64) NOT NULL,
    topic VARCHAR(255) NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_content_posts_composite UNIQUE (workspace_id, id),
    CONSTRAINT fk_content_posts_page
        FOREIGN KEY (workspace_id, facebook_page_id)
        REFERENCES facebook_pages(workspace_id, id)
        ON DELETE CASCADE
);
```

### Table: `post_versions`
Immutable versions of generated post captions and assets.

```sql
CREATE TABLE post_versions (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    post_id UUID NOT NULL,
    version_number INT NOT NULL,
    caption_bn TEXT NOT NULL,
    media_urls TEXT[],
    ai_model VARCHAR(64),
    prompt_tokens INT,
    completion_tokens INT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_post_versions_composite UNIQUE (workspace_id, id),
    CONSTRAINT fk_post_versions_post
        FOREIGN KEY (workspace_id, post_id)
        REFERENCES content_posts(workspace_id, id)
        ON DELETE CASCADE
);
```

### Table: `approval_requests`
Review workflow state.

```sql
CREATE TABLE approval_requests (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    post_id UUID NOT NULL,
    post_version_id UUID NOT NULL,
    requested_by UUID NOT NULL REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    CONSTRAINT fk_approval_post
        FOREIGN KEY (workspace_id, post_id)
        REFERENCES content_posts(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_approval_version
        FOREIGN KEY (workspace_id, post_version_id)
        REFERENCES post_versions(workspace_id, id)
        ON DELETE CASCADE
);
```

### Table: `scheduled_posts`
Durable schedule queue.

```sql
CREATE TABLE scheduled_posts (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    post_id UUID NOT NULL,
    post_version_id UUID NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'queued', 'publishing', 'published', 'failed', 'cancelled'
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_scheduled_posts_composite UNIQUE (workspace_id, id),
    CONSTRAINT fk_scheduled_post
        FOREIGN KEY (workspace_id, post_id)
        REFERENCES content_posts(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_scheduled_version
        FOREIGN KEY (workspace_id, post_version_id)
        REFERENCES post_versions(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_scheduled_posts_due ON scheduled_posts(scheduled_for) WHERE status IN ('scheduled', 'queued');
```

### Table: `publish_idempotency`
PostgreSQL correctness boundary for duplicate prevention.

```sql
CREATE TABLE publish_idempotency (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    scheduled_post_id UUID NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_publish_idempotency UNIQUE (workspace_id, idempotency_key),
    CONSTRAINT fk_idempotency_scheduled
        FOREIGN KEY (workspace_id, scheduled_post_id)
        REFERENCES scheduled_posts(workspace_id, id)
        ON DELETE CASCADE
);
```

### Table: `publish_attempts`
Sanitized telemetry log for every Graph API call.

```sql
CREATE TABLE publish_attempts (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    scheduled_post_id UUID NOT NULL,
    post_version_id UUID NOT NULL,
    attempt_number INT NOT NULL,
    endpoint VARCHAR(128) NOT NULL, -- e.g. "POST /{page_id}/feed" (access tokens strictly redacted)
    http_status INT,                -- e.g. 200, 400, 429
    fb_error_code INT,             -- e.g. 190, 32
    fb_error_subcode INT,          -- e.g. 463
    error_category VARCHAR(64),    -- e.g. "TOKEN_EXPIRED", "RATE_LIMIT", "TIMEOUT"
    duration_ms INT NOT NULL,
    retry_decision VARCHAR(32) NOT NULL, -- "RETRY_SCHEDULED", "MOVED_TO_DLQ", "ABORTED"
    trace_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_publish_attempts_scheduled
        FOREIGN KEY (workspace_id, scheduled_post_id)
        REFERENCES scheduled_posts(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_publish_attempts_version
        FOREIGN KEY (workspace_id, post_version_id)
        REFERENCES post_versions(workspace_id, id)
        ON DELETE CASCADE
);
```

### Table: `published_posts`
```sql
CREATE TABLE published_posts (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    post_id UUID NOT NULL,
    facebook_page_id UUID NOT NULL,
    fb_post_id VARCHAR(128) NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_published_post
        FOREIGN KEY (workspace_id, post_id)
        REFERENCES content_posts(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_published_page
        FOREIGN KEY (workspace_id, facebook_page_id)
        REFERENCES facebook_pages(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_published_fb_id ON published_posts(fb_post_id);
```

---

## 6. Billing, Auditing, and Webhooks Domain

### Table: `plans`
```sql
CREATE TABLE plans (
    id VARCHAR(32) PRIMARY KEY, -- 'starter', 'pro', 'agency'
    name VARCHAR(64) NOT NULL,
    price_inr INT NOT NULL,     -- In paise: 99900 = ₹999.00
    limits JSONB NOT NULL,      -- Max pages, members, drafts, media storage
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
```

### Table: `subscriptions`
```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    plan_id VARCHAR(32) NOT NULL REFERENCES plans(id),
    provider VARCHAR(32) NOT NULL DEFAULT 'razorpay',
    provider_subscription_id VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL, -- 'trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired'
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subscriptions_workspace UNIQUE (workspace_id)
);
```

### Table: `usage_counters`
```sql
CREATE TABLE usage_counters (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    metric VARCHAR(64) NOT NULL, -- 'drafts_generated', 'posts_published'
    period_start TIMESTAMPTZ NOT NULL,
    count INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_usage_period UNIQUE (workspace_id, metric, period_start)
);
```

### Table: `audit_logs`
```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL, -- 'post:created', 'page:connected', 'dna:updated'
    resource_type VARCHAR(64) NOT NULL,
    resource_id UUID,
    ip_address INET,
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_workspace ON audit_logs(workspace_id, created_at DESC);
```

### Table: `webhook_events`
```sql
CREATE TABLE webhook_events (
    id UUID PRIMARY KEY,
    event_id VARCHAR(128) NOT NULL UNIQUE, -- Provider unique event identifier
    provider VARCHAR(32) NOT NULL,        -- 'facebook', 'razorpay'
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'processed', 'failed'
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
