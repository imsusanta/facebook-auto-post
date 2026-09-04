# PostgreSQL Multi-Tenant Integration & Isolation Testing

## Overview

Tenant isolation and security boundaries in SaaS Phase 1 are validated using real PostgreSQL 16 loopback integration tests (`tests/postgres-runner.js`), executable via:

```bash
npm run test:postgres
```

The test runner operates under strict fail-closed constraints:
1. **Network Egress Guard**: Enforces that all outgoing connections are strictly bound to loopback addresses (`127.0.0.1`, `localhost`).
2. **Production Safety Guard**: Immediately terminates if `DATABASE_URL` targets remote, cloud, or production databases (e.g. AWS, RDS, Supabase, Neon).
3. **Environment Requirement**: Requires `NODE_ENV=test` and `STORAGE_MODE=postgres`.
4. **Data Tampering Protection**: Verifies SHA-256 integrity of `data/settings.json` to prove real application files are never touched.

---

## The 30 Cross-Tenant Test Assertions

The suite executes 30 specific assertions testing tenant isolation, RBAC boundaries, and transaction safety:

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
| 30 | **Connection pool shuts down cleanly** | `closePool()` terminates all pool connections cleanly without dangling handles. |

---

## Running Integration Tests

### Local Execution with Native PostgreSQL
```bash
DATABASE_URL="postgres://susantalohar@127.0.0.1:5432/facebook_auto_poster_test" npm run test:postgres
```

### Local Execution with Docker Compose
```bash
docker compose -f docker-compose.test.yml up -d
npm run test:postgres
docker compose -f docker-compose.test.yml down
```
