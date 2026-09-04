# Multi-Tenant PostgreSQL Data Model & Schema Specification

## 1. Data Modeling Conventions

1. **Primary Keys:** Every internal entity uses UUIDv7 identifiers (`uuid` type) to ensure time-ordered sortability, high insert performance in B-Trees, and zero sequential ID enumeration.
2. **External Identifiers:** Meta IDs (`facebook_user_id`, `facebook_page_id`, `facebook_post_id`) are stored as `VARCHAR(64)` text fields and are **never used as database primary keys**.
3. **Tenant Scoping:** All resources owned by a workspace contain a `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`.
4. **Audit Columns:** Every operational table contains `created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL`, `updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL`, `created_by UUID REFERENCES users(id)`, and `updated_by UUID REFERENCES users(id)`.
5. **Secret Marking:** Columns containing external credentials or sensitive keys are marked as `ENCRYPTED_FIELD` and stored as envelope-encrypted ciphertext strings (`v1:<iv>:<tag>:<ciphertext>`).

---

## 2. Identity & Access Domain

### 2.1. `users`
- **Description:** Global user registry. A user exists globally and can belong to multiple workspaces.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY (UUIDv7)
  - `email`: `VARCHAR(255) NOT NULL UNIQUE` (lowercase trimmed)
  - `password_hash`: `VARCHAR(255) NOT NULL` (PBKDF2/Argon2id)
  - `password_salt`: `VARCHAR(64) NOT NULL`
  - `full_name`: `VARCHAR(150) NOT NULL`
  - `avatar_url`: `VARCHAR(1024)`
  - `is_email_verified`: `BOOLEAN DEFAULT FALSE NOT NULL`
  - `status`: `VARCHAR(32) DEFAULT 'active' NOT NULL` ('active', 'suspended', 'deactivated')
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `updated_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
- **Ownership:** Global identity table (no `workspace_id`).
- **Unique Constraints:** `users_email_uniq (email)`
- **Indexes:** `idx_users_email (email)`, `idx_users_status (status)`
- **Secret Fields:** `password_hash`, `password_salt`
- **Deletion Policy:** Soft-delete (`status = 'deactivated'`). Anonymize email upon GDPR erasure request.
- **Retention:** Indefinite until explicit account deletion request.

### 2.2. `workspaces`
- **Description:** The root tenant entity. Isolates all pages, content, billing, and team members.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY (UUIDv7)
  - `name`: `VARCHAR(100) NOT NULL`
  - `slug`: `VARCHAR(120) NOT NULL UNIQUE` (URL-safe lowercase)
  - `owner_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
  - `status`: `VARCHAR(32) DEFAULT 'active' NOT NULL` ('active', 'suspended', 'archived')
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `updated_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
- **Ownership:** Self-root entity.
- **Unique Constraints:** `workspaces_slug_uniq (slug)`
- **Indexes:** `idx_workspaces_owner (owner_id)`, `idx_workspaces_status (status)`
- **Deletion Policy:** Soft-delete (`status = 'archived'`). Hard deletion requires operator verification after 30-day quarantine.

### 2.3. `workspace_members`
- **Description:** Associative table mapping users to workspaces with granular roles.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `role`: `VARCHAR(32) NOT NULL` ('owner', 'admin', 'editor', 'reviewer', 'viewer')
  - `status`: `VARCHAR(32) DEFAULT 'active' NOT NULL` ('active', 'suspended', 'left')
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `updated_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
- **Ownership:** Scoped to `workspace_id`.
- **Unique Constraints:** `ws_members_user_ws_uniq (workspace_id, user_id)`
- **Indexes:** `idx_ws_members_lookup (workspace_id, user_id, status)`, `idx_ws_members_user (user_id)`
- **Deletion Policy:** Soft-delete on member departure (`status = 'left'`).

### 2.4. `workspace_invitations`
- **Description:** Pending email invitations to join a workspace.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `email`: `VARCHAR(255) NOT NULL`
  - `role`: `VARCHAR(32) NOT NULL`
  - `token_hash`: `VARCHAR(64) NOT NULL UNIQUE` (SHA-256 of invitation token)
  - `invited_by`: `UUID NOT NULL REFERENCES users(id)`
  - `expires_at`: `TIMESTAMPTZ NOT NULL`
  - `accepted_at`: `TIMESTAMPTZ`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
- **Ownership:** Scoped to `workspace_id`.
- **Indexes:** `idx_invites_token (token_hash)`, `idx_invites_lookup (workspace_id, email)`
- **Retention:** Expired records purged after 30 days.

### 2.5. `sessions`
- **Description:** Relational mirror of active Redis session descriptors for auditability and session listing.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `active_workspace_id`: `UUID REFERENCES workspaces(id) ON DELETE SET NULL`
  - `session_token_hash`: `VARCHAR(64) NOT NULL UNIQUE` (SHA-256 of session token)
  - `ip_address`: `INET`
  - `user_agent`: `TEXT`
  - `expires_at`: `TIMESTAMPTZ NOT NULL`
  - `last_active_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
- **Ownership:** Bound to `user_id`, contextual to `active_workspace_id`.
- **Indexes:** `idx_sessions_token (session_token_hash)`, `idx_sessions_user (user_id, expires_at)`
- **Retention:** Hard delete upon session expiry or revocation.

### 2.6. `email_verification_tokens` & `password_reset_tokens`
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `token_hash`: `VARCHAR(64) NOT NULL UNIQUE`
  - `expires_at`: `TIMESTAMPTZ NOT NULL`
  - `used_at`: `TIMESTAMPTZ`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
- **Indexes:** `idx_tokens_hash (token_hash)`
- **Retention:** Purged 24 hours after use or expiry.

---

## 3. Facebook Integration Domain

### 3.1. `facebook_connections`
- **Description:** Represents a user's OAuth connection to Meta on behalf of a workspace.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `user_id`: `UUID NOT NULL REFERENCES users(id)`
  - `facebook_user_id`: `VARCHAR(64) NOT NULL`
  - `user_access_token`: `TEXT NOT NULL` [ENCRYPTED_FIELD]
  - `token_expires_at`: `TIMESTAMPTZ NOT NULL`
  - `scopes`: `TEXT[] NOT NULL`
  - `status`: `VARCHAR(32) DEFAULT 'active' NOT NULL` ('active', 'expired', 'revoked')
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `updated_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
- **Ownership:** Scoped to `workspace_id`.
- **Unique Constraints:** `fb_conn_ws_fbuser_uniq (workspace_id, facebook_user_id)`
- **Secret Fields:** `user_access_token`
- **Indexes:** `idx_fb_conn_lookup (workspace_id, status)`

### 3.2. `facebook_pages`
- **Description:** Connected Facebook Pages managed within a workspace.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `connection_id`: `UUID NOT NULL REFERENCES facebook_connections(id) ON DELETE RESTRICT`
  - `facebook_page_id`: `VARCHAR(64) NOT NULL`
  - `name`: `VARCHAR(255) NOT NULL`
  - `category`: `VARCHAR(100)`
  - `page_access_token`: `TEXT NOT NULL` [ENCRYPTED_FIELD]
  - `token_expires_at`: `TIMESTAMPTZ`
  - `picture_url`: `TEXT`
  - `onboarding_status`: `VARCHAR(32) DEFAULT 'not_started' NOT NULL`
  - `is_active`: `BOOLEAN DEFAULT TRUE NOT NULL`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `updated_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
- **Ownership:** Scoped to `workspace_id`.
- **Unique Constraints:**
  - `fb_pages_ws_fbpage_uniq (workspace_id, facebook_page_id)`
  - Global constraint: `fb_pages_global_unique (facebook_page_id)` enforces single-workspace ownership in MVP.
- **Secret Fields:** `page_access_token`
- **Indexes:** `idx_fb_pages_ws_active (workspace_id, is_active)`, `idx_fb_pages_fbid (facebook_page_id)`

### 3.3. `facebook_webhook_subscriptions`
- **Description:** Tracks Meta Webhook event subscriptions and webhook verify tokens per page.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `facebook_page_id`: `VARCHAR(64) NOT NULL REFERENCES facebook_pages(facebook_page_id)`
  - `subscribed_fields`: `TEXT[] NOT NULL`
  - `status`: `VARCHAR(32) DEFAULT 'active' NOT NULL`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`

### 3.4. `facebook_token_events`
- **Description:** Immutable ledger of token refresh, expiration, and invalidation events.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `page_id`: `UUID REFERENCES facebook_pages(id) ON DELETE CASCADE`
  - `event_type`: `VARCHAR(32) NOT NULL` ('refresh_success', 'refresh_failed', 'revocation_detected', 'expired')
  - `details`: `JSONB`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`

---

## 4. Page DNA Domain

### 4.1. `page_content_profiles`
- **Description:** The live Page DNA profile attached to a connected Facebook Page.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `page_id`: `UUID NOT NULL UNIQUE REFERENCES facebook_pages(id) ON DELETE CASCADE`
  - `schema_version`: `INTEGER DEFAULT 1 NOT NULL`
  - `niche`: `VARCHAR(100) NOT NULL`
  - `niche_description`: `VARCHAR(500)`
  - `primary_goal`: `VARCHAR(32) NOT NULL`
  - `secondary_goals`: `TEXT[] DEFAULT '{}' NOT NULL`
  - `language`: `VARCHAR(16) DEFAULT 'bn' NOT NULL`
  - `language_style`: `VARCHAR(150)`
  - `tone`: `TEXT[] NOT NULL`
  - `audience_locations`: `TEXT[] DEFAULT '{}' NOT NULL`
  - `audience_professions`: `TEXT[] DEFAULT '{}' NOT NULL`
  - `audience_interests`: `TEXT[] DEFAULT '{}' NOT NULL`
  - `knowledge_level`: `VARCHAR(32) DEFAULT 'mixed' NOT NULL`
  - `content_pillars`: `JSONB NOT NULL` (array of pillars with title, weight, id)
  - `content_mix`: `JSONB NOT NULL` (educational, community, authority, timely, promotional summing to 100)
  - `promotional_limit_percent`: `INTEGER DEFAULT 10 NOT NULL`
  - `source_policy`: `JSONB DEFAULT '{}' NOT NULL`
  - `blocked_topics`: `TEXT[] DEFAULT '{}' NOT NULL`
  - `blocked_claims`: `TEXT[] DEFAULT '{}' NOT NULL`
  - `preferred_formats`: `TEXT[] NOT NULL`
  - `cta_style`: `VARCHAR(32) DEFAULT 'soft' NOT NULL`
  - `hashtag_style`: `VARCHAR(32) DEFAULT 'minimal' NOT NULL`
  - `hashtag_limit`: `INTEGER DEFAULT 5 NOT NULL`
  - `emoji_limit`: `INTEGER DEFAULT 3 NOT NULL`
  - `caption_min_chars`: `INTEGER DEFAULT 300 NOT NULL`
  - `caption_max_chars`: `INTEGER DEFAULT 2000 NOT NULL`
  - `timezone`: `VARCHAR(64) DEFAULT 'Asia/Kolkata' NOT NULL`
  - `max_posts_per_day`: `INTEGER DEFAULT 3 NOT NULL`
  - `minimum_post_gap_minutes`: `INTEGER DEFAULT 180 NOT NULL`
  - `approval_mode`: `VARCHAR(32) DEFAULT 'manual' NOT NULL`
  - `learned_preferences`: `TEXT[] DEFAULT '{}' NOT NULL`
  - `version_number`: `INTEGER DEFAULT 1 NOT NULL`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `updated_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `updated_by`: `UUID REFERENCES users(id)`
- **Ownership:** Scoped to `workspace_id`.
- **Indexes:** `idx_dna_ws_page (workspace_id, page_id)`

### 4.2. `page_content_profile_versions`
- **Description:** Append-only history of every Page DNA update for audit and rollback.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `profile_id`: `UUID NOT NULL REFERENCES page_content_profiles(id) ON DELETE CASCADE`
  - `version_number`: `INTEGER NOT NULL`
  - `profile_snapshot`: `JSONB NOT NULL`
  - `change_summary`: `TEXT`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `created_by`: `UUID REFERENCES users(id)`
- **Indexes:** `idx_dna_versions (profile_id, version_number)`

---

## 5. Content & Editorial Workflow Domain

### 5.1. `content_ideas`
- **Description:** Topic ideation pool and suggested angles.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `page_id`: `UUID NOT NULL REFERENCES facebook_pages(id) ON DELETE CASCADE`
  - `pillar_id`: `VARCHAR(64)`
  - `topic_title`: `VARCHAR(255) NOT NULL`
  - `source_url`: `TEXT`
  - `status`: `VARCHAR(32) DEFAULT 'new' NOT NULL`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`

### 5.2. `post_drafts`
- **Description:** Content items undergoing creation, review, and editing.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `page_id`: `UUID NOT NULL REFERENCES facebook_pages(id) ON DELETE CASCADE`
  - `current_version_id`: `UUID`
  - `content_pillar`: `VARCHAR(100)`
  - `content_mix_type`: `VARCHAR(32)`
  - `status`: `VARCHAR(32) DEFAULT 'draft' NOT NULL` ('draft', 'in_review', 'approved', 'rejected', 'scheduled', 'published')
  - `risk_level`: `VARCHAR(16) DEFAULT 'low' NOT NULL` ('low', 'medium', 'high')
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `updated_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `created_by`: `UUID REFERENCES users(id)`
- **Indexes:** `idx_drafts_ws_status (workspace_id, status)`

### 5.3. `post_versions`
- **Description:** Revision history for post copies and graphic assets.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `draft_id`: `UUID NOT NULL REFERENCES post_drafts(id) ON DELETE CASCADE`
  - `version_number`: `INTEGER NOT NULL`
  - `caption_bengali`: `TEXT NOT NULL`
  - `headline`: `VARCHAR(255)`
  - `media_asset_id`: `UUID REFERENCES media_assets(id)`
  - `ai_model`: `VARCHAR(64)`
  - `prompt_tokens`: `INTEGER`
  - `completion_tokens`: `INTEGER`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `created_by`: `UUID REFERENCES users(id)`

### 5.4. `approval_requests`
- **Description:** Review governance records for sign-off workflows.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `draft_id`: `UUID NOT NULL REFERENCES post_drafts(id) ON DELETE CASCADE`
  - `status`: `VARCHAR(32) DEFAULT 'pending' NOT NULL` ('pending', 'approved', 'rejected')
  - `reviewer_id`: `UUID REFERENCES users(id)`
  - `review_comments`: `TEXT`
  - `reviewed_at`: `TIMESTAMPTZ`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`

### 5.5. `scheduled_posts`
- **Description:** Approved posts queued for future publication.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `page_id`: `UUID NOT NULL REFERENCES facebook_pages(id) ON DELETE RESTRICT`
  - `draft_id`: `UUID NOT NULL REFERENCES post_drafts(id) ON DELETE RESTRICT`
  - `post_version_id`: `UUID NOT NULL REFERENCES post_versions(id) ON DELETE RESTRICT`
  - `scheduled_at`: `TIMESTAMPTZ NOT NULL`
  - `status`: `VARCHAR(32) DEFAULT 'pending' NOT NULL` ('pending', 'enqueued', 'publishing', 'published', 'failed', 'cancelled')
  - `idempotency_key`: `VARCHAR(64) NOT NULL UNIQUE`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
  - `updated_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
- **Indexes:** `idx_sched_due (status, scheduled_at)`, `idx_sched_ws (workspace_id, status)`

### 5.6. `publish_attempts` & `published_posts`
- **`publish_attempts`:** Log of worker publish invocations with latency, status codes, and error bodies.
- **`published_posts`:** Final published records storing `meta_post_id`, permalink URL, published timestamp, and engagement counters.

### 5.7. `media_assets`
- **Description:** Metadata for image and graphic assets stored in S3/R2.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `s3_key`: `VARCHAR(512) NOT NULL UNIQUE`
  - `file_name`: `VARCHAR(255) NOT NULL`
  - `content_type`: `VARCHAR(64) NOT NULL`
  - `byte_size`: `BIGINT NOT NULL`
  - `sha256_hash`: `VARCHAR(64) NOT NULL`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`

---

## 6. SaaS & Operations Domain

### 6.1. `plans` & `subscriptions`
- **`plans`:** Tier catalog (`starter`, `creator`, `agency`) with prices, currency (`INR`), and quota limits.
- **`subscriptions`:** Tracks Razorpay subscription ID, current status (`trialing`, `active`, `past_due`, `cancelled`, `expired`), current period dates, and cancellation timestamp.

### 6.2. `usage_events` & `usage_counters`
- **`usage_events`:** Append-only event log recording AI token generation, publish events, and media uploads.
- **`usage_counters`:** Real-time quota aggregates per workspace per billing cycle (`(workspace_id, billing_period_start)`).

### 6.3. `audit_logs`
- **Description:** Immutable security ledger recording all mutating operator actions.
- **Columns:**
  - `id`: `UUID` PRIMARY KEY
  - `workspace_id`: `UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
  - `user_id`: `UUID REFERENCES users(id)`
  - `action`: `VARCHAR(64) NOT NULL` (e.g. 'page_dna.updated', 'member.invited', 'post.scheduled')
  - `resource_type`: `VARCHAR(64) NOT NULL`
  - `resource_id`: `VARCHAR(64) NOT NULL`
  - `ip_address`: `INET`
  - `user_agent`: `TEXT`
  - `payload_diff`: `JSONB`
  - `created_at`: `TIMESTAMPTZ DEFAULT NOW() NOT NULL`
- **Indexes:** `idx_audit_ws_time (workspace_id, created_at DESC)`
- **Retention:** Minimum 365 days. Never deleted on tenant workspace deletion (transferred to compliance archive).
