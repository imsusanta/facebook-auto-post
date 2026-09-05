# Historical Phase 1 test inventory

> Superseded for current execution/status by [security/identity pass](security-identity-pass.md) and [local development](local-development.md). The old table below is historical, not current coverage proof.

# PostgreSQL Multi-Tenant Integration & Isolation Testing

## Overview

Tenant isolation and security boundaries in SaaS Phase 1 are validated using real PostgreSQL 16 loopback integration tests (`tests/postgres-runner.js`), executable via:

```bash
npm run test:postgres
```

The test runner operates under strict fail-closed constraints:
1. **Isolated Schema Lifecycle**: Every test run generates a unique, randomized PostgreSQL schema (`test_schema_<timestamp>_<random>`), sets `search_path`, executes migrations, and drops the schema with `CASCADE` on teardown unless `DEBUG_RETAIN_TEST_DB=true`. Never pollutes `public` or leaves test remnants.
2. **Network Egress Guard**: Enforces that all outgoing connections are strictly bound to loopback addresses (`127.0.0.1`, `localhost`).
3. **Production Safety Guard**: Immediately terminates if `DATABASE_URL` targets remote, cloud, or production databases (e.g. AWS, RDS, Supabase, Neon).
4. **Environment Requirement**: Requires `NODE_ENV=test` and `STORAGE_MODE=postgres`.
5. **Data Tampering Protection**: Verifies SHA-256 integrity of `data/settings.json` to prove real application files are never touched.

---

## The 56 Cross-Tenant Test Assertions

The suite executes 56 specific assertions testing tenant isolation, RBAC boundaries, invitation security, transaction concurrency, active-principal rules, and authentication integration:

| # | Assertion | Verification Mechanism |
| :- | :--- | :--- |
| 1 | **User A can read Workspace A** | `GET /api/v1/workspaces/:wsA` returns 200 with workspace and role `'owner'`. |
| 2 | **User A cannot read Workspace B** | `GET /api/v1/workspaces/:wsB` returns 404 `WORKSPACE_NOT_FOUND`. |
| 3 | **User B cannot update Workspace A** | `PATCH /api/v1/workspaces/:wsA` returns 404; Workspace A remains unchanged. |
| 4 | **User A cannot list Workspace B members** | `GET /api/v1/workspaces/:wsB/members` returns 404 `WORKSPACE_NOT_FOUND`. |
| 5 | **User A cannot invite members to Workspace B** | `POST /api/v1/workspaces/:wsB/invitations` returns 404 `WORKSPACE_NOT_FOUND`. |
| 6 | **User A cannot change a Workspace B role** | `PATCH /api/v1/workspaces/:wsB/members/:userB/role` returns 404. |
| 7 | **User A cannot remove a Workspace B member** | `DELETE /api/v1/workspaces/:wsB/members/:userB` returns 404. |
| 8 | **User A cannot read Workspace B audit logs** | `GET /api/v1/workspaces/:wsB/audit-logs` returns 404. |
| 9 | **Identical 404 response shapes** | Non-existent workspace and foreign workspace return identical JSON keys and messages. |
| 10 | **Body `workspaceId` override rejection** | Supplying `workspaceId` in body returns 400 `VALIDATION_FAILED`. |
| 11 | **Viewer cannot update workspace** | Viewer calling `PATCH /api/v1/workspaces/:wsA` returns 403 `PERMISSION_DENIED`. |
| 12 | **Editor cannot invite members** | Editor calling `POST /api/v1/workspaces/:wsA/invitations` returns 403 `PERMISSION_DENIED`. |
| 13 | **Reviewer cannot change roles** | Reviewer calling `PATCH .../role` returns 403 `PERMISSION_DENIED`. |
| 14 | **Admin cannot grant owner** | Admin attempting to promote member to `'owner'` returns 403 `PERMISSION_DENIED`. |
| 15 | **User cannot promote self** | Admin attempting to alter own role returns 403 `PERMISSION_DENIED`. |
| 16 | **Final owner cannot be removed** | Sole owner attempting to remove self returns 403 `PERMISSION_DENIED`. |
| 17 | **Suspended member loses access** | Member status set to `'suspended'` immediately returns 404 on subsequent requests. |
| 18 | **Removed member loses access** | Removed member immediately returns 404 on subsequent requests. |
| 19 | **Duplicate membership is rejected** | Attempting to insert existing user into workspace fails on unique constraint. |
| 20 | **Atomic workspace & owner creation** | `createWorkspaceWithOwner` transactionally creates workspace and owner membership. |
| 21 | **Failed owner membership rolls back** | Invalid user ID rolls back workspace creation; no orphan workspace persists. |
| 22 | **Invitation token stored only as hash** | Plaintext token returned once; database only stores SHA-256 `token_hash`. |
| 23 | **Expired invitation cannot be accepted** | Invitation with past expiration fails acceptance and marks status `'expired'`. |
| 24 | **Revoked invitation cannot be reused** | Revoked invitation fails acceptance with `INVITATION_INVALID`. |
| 25 | **Audit metadata strips sensitive keys** | `password`, `token`, `secret_key` keys are redacted to `[REDACTED]` in metadata. |
| 26 | **Cross-tenant audit isolation** | Querying Workspace B audit logs yields zero Workspace A records. |
| 27 | **SQL injection payloads remain inert** | Malformed UUIDs fail validation with 400; SQL payloads in strings remain inert. |
| 28 | **Concurrent slug race handling** | Concurrent workspace creations with same slug yield exactly 1 winner and 1 conflict (23505). |
| 29 | **Database failure returns sanitized error** | Invalid requests return sanitized JSON codes with zero stack traces or connection strings. |
| 30 | **Connection pool is active & operational** | Connection pool remains alive, responsive, and handles active transactional traffic. |
| 31 | **DELETE member persists status = 'removed'** | Soft removal sets `status = 'removed'`; member record is retained for audit while access is denied. |
| 32 | **Concurrent final-owner demotion race** | Simultaneous demote/remove requests on dual owners serialize; workspace never has 0 active owners. |
| 33 | **Stale or spoofed actorRole bypassed** | Authoritative database role reloaded in transaction prevents caller role spoofing. |
| 34 | **Suspended/removed actor cannot modify** | Inactive or removed member attempting mutations fails with actor not active in workspace. |
| 35 | **Verified email binding on invitations** | Rejects unverified users, mismatched emails, and suspended accounts; matching verified user succeeds. |
| 36 | **Concurrent invitation acceptance race** | Two simultaneous accept calls with single-use token produce exactly 1 success and 1 rejection. |
| 37 | **Duplicate pending invite conflict** | Partial unique index rejects duplicate pending invites with 409 `CONFLICT`. |
| 38 | **Inviter deletion preserves invitation history** | Foreign key `invited_by ON DELETE SET NULL` preserves invitation history when inviter is deleted. |
| 39 | **Invitation TTL validation bounds** | Enforces integer between 1 and 168 hours; rejects negative, fractional, or >168 values. |
| 40 | **Production database URL guard** | Rejects cloud, AWS, RDS, Neon, Supabase, or non-local database URLs in test mode. |
| 41 | **Pool reset lifecycle drain** | `resetPool()` ends active clients cleanly; new pool initializes without client leaks. |
| 42 | **Migration runner safety guards** | Rejects invalid migration filenames, duplicate version prefixes, and empty files. |
| 43 | **Complete Active-Principal (Users)** | Suspended and deleted users are rejected across all workspace child endpoints. |
| 44 | **Complete Active-Principal (Workspaces)** | Suspended/paused and deleted workspaces are rejected across all endpoints. |
| 45 | **Invitation Lifecycle: Anti-Self-Reactivation** | Suspended members cannot self-reactivate via invitations. |
| 46 | **Invitation Lifecycle: Member Removal Revocation** | Removing an active or suspended member revokes all pending invitations for that member. |
| 47 | **Invitation Lifecycle: Removed Member Reactivation** | Removed member can be reactivated with fresh authorized invitation acceptance. |
| 48 | **Invitation Lifecycle: Stale Invitation Cleanup** | Stale pending invitations are transactionally expired before creating a replacement. |
| 49 | **Invitation Lifecycle: Inviter Authority Check** | Acceptance fails if issuing inviter lost administrative authority or was removed. |
| 50 | **Fault Injection: Zero Secret Canary Leakage** | Database failure with injected secret canary returns generic 500 without leaking canary. |
| 51 | **Injected Session & CSRF Middleware** | Workspace read and mutation succeed when authenticated via session cookie and CSRF token. |
| 52 | **Injected Session CSRF Protection** | Rejects mutations without CSRF token or with invalid CSRF token (403 `CSRF_TOKEN_INVALID`). |
| 53 | **Injected Session Cross-Tenant Denial** | Session authenticated as User B cannot read or access Workspace A. |
| 54 | **Test Identity Header Gating** | Header `x-test-user-id` is rejected with 401 in production, development, or unset environments. |
| 55 | **Legacy Route Boundary Isolation** | Ordinary SaaS users (`role: 'user'`) receive 403 `FORBIDDEN_ROLE` on legacy operator routes. |
| 56 | **Atomic Transactional Audit Logging** | Verifies persistent audit records committed inside same transaction for all workspace mutations. |

---

## Running Integration & Security Tests

### 1. PostgreSQL Tenancy Integration Suite (56 Assertions)
```bash
# Local Execution with Native PostgreSQL:
ALLOW_TEST_DATABASE=true NODE_ENV=test DATABASE_URL="postgres://app_test:test_password_only@127.0.0.1:5432/facebook_auto_poster_test" npm run test:postgres

# Or with Docker Compose:
docker compose -f docker-compose.test.yml up -d
npm run test:postgres
docker compose -f docker-compose.test.yml down
```

### 2. Database Safety Guard Unit Tests (14 Assertions)
```bash
npm run test:safety-guard
```

### 3. Clean-Worktree End-to-End Verification Runner
Executes the full 7-step verification gate (lint, encoding, safety guard, unit tests, browser tests, postgres runner, and clean worktree post-run):
```bash
EXPECTED_HEAD="$(git rev-parse HEAD)" ALLOW_TEST_DATABASE=true npm run verify:clean
# Or directly:
bash scripts/verify-clean-worktree.sh

# Self-testing failure mode:
bash scripts/verify-clean-worktree.sh --test-failure-mode
```

