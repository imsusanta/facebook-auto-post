# PostgreSQL Multi-Tenancy Foundation (Phase 1)

## Overview

SaaS Phase 1 introduces the multi-tenant relational persistence foundation for the Bengali-first Facebook Auto-Poster SaaS. The persistence layer is powered by PostgreSQL 16, utilizing a lean, explicit architecture without heavy ORM bloat.

The implementation prioritizes:
1. **Strict logical tenant isolation** via URL-scoped workspace context.
2. **Deterministic data access** via explicit parameterized repositories.
3. **Fail-closed security controls** preventing cross-tenant enumeration, privilege escalation, and token leakage.
4. **Idempotent, transactional SQL migrations** with advisory concurrency locks.
5. **Zero regressions** against existing single-tenant legacy file storage.

---

## Architectural Components

```
+-------------------------------------------------------------+
|               Express Application Routes                    |
|       /api/v1/workspaces/:workspaceId/...                   |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|            Workspace Context & RBAC Middleware              |
|   - resolveWorkspaceContext (URL parameter validation)      |
|   - Anti-Body-Tampering (rejects body.workspaceId)          |
|   - Anti-Enumeration (uniform 404 for missing/forbidden)    |
|   - requireWorkspacePermission (RBAC role verification)     |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                     Repository Layer                        |
|   - UserRepository                                          |
|   - WorkspaceRepository                                     |
|   - MembershipRepository                                    |
|   - InvitationRepository                                    |
|   - AuditLogRepository                                      |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|              PostgreSQL Connection & Engine                 |
|   - db/index.js (pg.Pool, withTransaction, query)           |
|   - db/uuid.js (Monotonic RFC 9562 UUIDv7)                  |
|   - db/migrator.js (Advisory locking & checksums)           |
+-------------------------------------------------------------+
```

---

## Database Configuration & Lifecycle

Configuration is managed via `config/database.js` and loaded dynamically via environment variables:

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `STORAGE_MODE` | String | `legacy` | Runtime mode: `legacy` (JSON files) or `postgres` (PostgreSQL 16) |
| `DATABASE_URL` | String | *None* | Connection URI (e.g. `postgres://user:pass@127.0.0.1:5432/app`) |
| `DATABASE_SSL` | Boolean | `false` | Enables SSL/TLS. In production, enforces certificate verification |
| `DATABASE_POOL_MIN` | Integer | `2` | Minimum active connections in the pool |
| `DATABASE_POOL_MAX` | Integer | `10` | Maximum connections allowed in the pool |
| `DATABASE_STATEMENT_TIMEOUT_MS` | Integer | `10000` | Query execution deadline before timeout (ms) |

### Safety Rules
- **No Secret Logging**: `DATABASE_URL` is never written to logs or error messages.
- **Fail-Closed Startup**: If `STORAGE_MODE=postgres` is requested in production but `DATABASE_URL` is absent, application boot halts immediately.
- **No Silent Fallback**: The server never silently falls back to legacy file storage when PostgreSQL mode fails.
- **Graceful Pool Shutdown**: `closePool()` drains active queries and terminates pool connections cleanly on `SIGTERM` and during teardown.

---

## Migration Runner

Database migrations are versioned SQL scripts located in `migrations/postgres/`:

- Forward migrations: `NNN_name.sql`
- Rollback migrations: `NNN_name_down.sql`

### Concurrency & Integrity Controls
1. **Advisory Locks**: `pg_advisory_lock(8392104, 9281729)` prevents race conditions when multiple containers or cluster nodes start concurrently.
2. **Schema Tracking Table**: `schema_migrations` records the migration version, name, SHA-256 checksum, and execution timestamp.
3. **Checksum Verification**: Modifying an already-applied migration file triggers an error, preventing drift.
4. **Per-Migration Transactions**: Each migration runs inside `BEGIN ... COMMIT`, ensuring zero partial application on syntax error.

### CLI Commands
- Apply pending migrations:
  ```bash
  npm run db:migrate
  ```
- Check migration status:
  ```bash
  npm run db:migrate:status
  ```
- Rollback most recent migration:
  ```bash
  npm run db:rollback
  ```

---

## Relational Schema & Tables

### 1. `001_extensions.sql`
Enables `uuid-ossp` and `pgcrypto` extensions.

### 2. `002_users.sql`
Stores user identity:
- `id` (UUIDv7 PRIMARY KEY)
- `email` (VARCHAR(255) NOT NULL)
- `email_normalized` (VARCHAR(255) UNIQUE NOT NULL)
- `password_hash` (VARCHAR(255) NOT NULL, format: `pbkdf2_sha512$100000$salt$hash`)
- `password_algorithm` (VARCHAR(32) NOT NULL DEFAULT `'pbkdf2_sha512'`)
- `status` (VARCHAR(32) NOT NULL DEFAULT `'active'`)
- `created_at`, `updated_at`, `deleted_at`

### 3. `003_workspaces.sql`
Stores workspace entity:
- `id` (UUIDv7 PRIMARY KEY)
- `name` (VARCHAR(255) NOT NULL)
- `slug` (VARCHAR(255) UNIQUE NOT NULL)
- `status` (VARCHAR(32) NOT NULL DEFAULT `'active'`)
- `created_by` (UUID NOT NULL REFERENCES users(id))
- `created_at`, `updated_at`, `deleted_at`

### 4. `004_workspace_members.sql`
Stores workspace memberships and roles:
- `workspace_id` (UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE)
- `user_id` (UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE)
- `role` (VARCHAR(32) NOT NULL CHECK in `owner`, `admin`, `editor`, `reviewer`, `viewer`)
- `status` (VARCHAR(32) NOT NULL DEFAULT `'active'` CHECK in `active`, `suspended`, `left`)
- `joined_at`, `created_at`, `updated_at`
- PRIMARY KEY: `(workspace_id, user_id)`

### 5. `005_workspace_invitations.sql`
Stores workspace invitations:
- `id` (UUIDv7 PRIMARY KEY)
- `workspace_id` (UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE)
- `email_normalized` (VARCHAR(255) NOT NULL)
- `role` (VARCHAR(32) NOT NULL CHECK in `admin`, `editor`, `reviewer`, `viewer`)
- `token_hash` (VARCHAR(64) UNIQUE NOT NULL) — only SHA-256 hash stored
- `invited_by` (UUID NOT NULL REFERENCES users(id))
- `status` (VARCHAR(32) NOT NULL DEFAULT `'pending'` CHECK in `pending`, `accepted`, `revoked`, `expired`)
- `expires_at`, `accepted_at`, `created_at`

### 6. `006_audit_logs.sql`
Stores append-only security and operational events:
- `id` (UUIDv7 PRIMARY KEY)
- `workspace_id` (UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE)
- `actor_user_id` (UUID REFERENCES users(id) ON DELETE SET NULL)
- `action` (VARCHAR(128) NOT NULL)
- `resource_type` (VARCHAR(64) NOT NULL)
- `resource_id` (VARCHAR(128))
- `outcome` (VARCHAR(32) NOT NULL DEFAULT `'success'`)
- `request_id` (VARCHAR(64))
- `ip_hash` (VARCHAR(64))
- `user_agent_summary` (VARCHAR(255))
- `metadata` (JSONB NOT NULL DEFAULT `'{}'::jsonb`)
- `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())

---

## Repository Layer

Repositories encapsulate all database interactions and enforce mandatory tenant scoping:

1. **Explicit Parameterization**: All SQL queries use `$1, $2, ...` placeholders. Raw string interpolation is strictly prohibited.
2. **Mandatory `workspaceId`**: Every tenant-owned repository query explicitly includes `workspaceId` (e.g. `WHERE workspace_id = $1 AND ...`).
3. **Transaction Helper**: `withTransaction(async (client) => { ... })` provides atomic commit and automatic rollback on error.
4. **Safe Serialization**:
   - `userRepository` strips `password_hash` and internal security fields before returning user objects.
   - `invitationRepository` returns the plaintext invitation token exactly once upon creation; only its SHA-256 hash is persisted.
   - `auditLogRepository` strips sensitive keys (`password`, `token`, `secret`, `authorization`, `cookie`, `key`) from metadata before persistence.
