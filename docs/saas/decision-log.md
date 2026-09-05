# SaaS Architecture Decision Records (ADR Log)

## Status Legend
- **Proposed**: Under team review, awaiting formal validation.
- **Accepted**: Formal decision approved for implementation.
- **Superseded**: Replaced by a subsequent architectural decision.

```
+---------+-----------------------------------------------------+-------------+
| ADR ID  | Title                                               | Status      |
+---------+-----------------------------------------------------+-------------+
| ADR-001 | Multi-Tenancy Strategy (Shared Database with Keys)  | Accepted    |
| ADR-002 | Session Store & Auth via Redis Opaque Bearer Tokens | Accepted    |
| ADR-003 | Meta OAuth 2.0 & Privacy-Safe 1:1 Page Ownership    | Accepted    |
| ADR-004 | PostgreSQL Idempotency Boundary & BullMQ Worker     | Accepted    |
| ADR-005 | India-First Billing Provider (Razorpay Proposal)    | Proposed    |
| ADR-006 | Page DNA (PR #2) Selective Integration Strategy     | Accepted    |
| ADR-007 | Two-Phase CLI Migration & PR Review Sequence        | Accepted    |
| ADR-008 | URL-Scoped Workspace Context & Anti-Body-Tampering  | Accepted    |
| ADR-009 | PostgreSQL Repository Strategy with Standard UUIDv4 | Accepted    |
| ADR-010 | One-Workspace-Per-Facebook-Page MVP Rule            | Accepted    |
| ADR-011 | India-First Billing Deferred to Phase 4             | Accepted    |
| ADR-012 | Legacy Storage Compatibility Boundary & Dual Mode   | Accepted    |
| ADR-013 | Canonical Membership Lifecycle & Verified Invites   | Accepted    |
+---------+-----------------------------------------------------+-------------+
```

---

## ADR-001: Multi-Tenancy Strategy (Shared Database with Composite Relational Keys)

### Status: Accepted
### Context
The existing application stores settings, users, queue, and history in single-tenant JSON files. We need a secure, cost-effective isolation model supporting hundreds of small businesses and digital agencies.

### Decision
Adopt a **shared PostgreSQL 16 database with logical row-level tenant scoping** (`workspace_id` on all tenant tables) and **composite foreign keys** (`FOREIGN KEY (workspace_id, parent_id) REFERENCES parent_table(workspace_id, id)`).

### Alternatives Considered
1. **Database-per-Tenant**: Massive operational overhead, slow migrations, and expensive connection pooling.
2. **Schema-per-Tenant**: Complex DDL migrations and connection cache bloat.

### Consequences
- **Positive**: Cost-effective, simplified cross-tenant backups, database engine enforces tenant boundaries across relational joins.
- **Negative**: Requires strict repository-level query hygiene (`WHERE id = $1 AND workspace_id = $2`).

---

## ADR-002: Session Store & Authentication via Redis Opaque Bearer Tokens

### Status: Accepted
### Context
Currently, sessions reside in an in-memory `Map` inside `middleware/auth.js`, which is destroyed on process restart. Furthermore, storing a single mutable active workspace in the session creates race conditions in multi-tab agency workflows.

### Decision
Use **Redis-backed opaque bearer sessions storing only SHA-256 token hashes**. Decouple user identity from workspace context: user identity is authenticated via session, while **workspace execution context is explicitly specified per-request via URL path (`/api/v1/workspaces/:wsId/...`) and validated against `workspace_members`**. Passwords migrate seamlessly from legacy PBKDF2-HMAC-SHA512 to Argon2id upon successful login without forced resets.

### Alternatives Considered
1. **Stateless JWTs**: Cannot be revoked immediately upon member removal or password change.
2. **Single Mutable Workspace in Session**: Causes multi-tab context collision.

### Consequences
- **Positive**: Sub-millisecond validation, instant revocation cascades, completely multi-tab safe.
- **Negative**: Adds Redis as a hard operational dependency.

---

## ADR-003: Meta OAuth 2.0 & Privacy-Safe 1:1 Facebook Page Ownership

### Status: Accepted
### Context
Facebook credentials currently consist of manually pasted tokens in settings or environment variables. Users cannot connect their pages dynamically.

### Decision
Implement the **standard Meta OAuth 2.0 Authorization Code Flow** using server-side random state tokens (256 bits entropy) whose SHA-256 hashes are stored in Redis for one-time consumption. Enforce **strict 1:1 page ownership** with a **privacy-safe conflict process** (zero exposure of competing workspace metadata, generic 409 response, rate-limiting repeated claims, and discreet owner alerts). Tokens are encrypted using AES-256-GCM envelope encryption.

### Alternatives Considered
1. **Self-Contained Signed State Tokens**: Exposes encrypted or signed metadata in the URL. Rejected in favor of opaque server-side Redis state.
2. **Revealing Existing Workspace Metadata on Conflict**: Rejected due to competitor privacy risks.

### Consequences
- **Positive**: Complete privacy protection, zero token exposure in browser, secure long-lived token exchange.
- **Negative**: Legitimate ownership transfers require an administrative review flow.

---

## ADR-004: Asynchronous Processing with PostgreSQL Idempotency Boundary

### Status: Accepted
### Context
Current scheduling uses in-process `node-cron` and `setInterval` in `services/scheduler.js`. Crashes drop scheduled posts silently.

### Decision
Establish **PostgreSQL as the definitive correctness boundary for publishing idempotency** using a dedicated `publish_idempotency` table with a unique constraint `UNIQUE(workspace_id, idempotency_key)` and row-level locking (`SELECT ... FOR UPDATE`). Deploy a **right-sized MVP BullMQ worker service** backed by Redis for queue management, utilizing Redlock as a contention optimization. Implement telemetry redaction to guarantee zero secret leakage in `publish_attempts`.

### Alternatives Considered
1. **Redis-Only Idempotency**: Redis key evictions or network partitions could permit duplicate publishing to Facebook.
2. **Complex Multi-Fleet Worker Topology**: Premature for MVP scale; consolidated into a single worker service.

### Consequences
- **Positive**: Zero duplicate posts even during worker crashes, resilient exponential backoff, safe telemetry logging.
- **Negative**: Additional database write for idempotency tracking.

---

## ADR-005: India-First Billing Provider (Razorpay Proposal)

### Status: Proposed (To Be Validated in Phase 4)
### Context
The application targets Bengali creators, coaching centres, restaurants, and local businesses in West Bengal and India.

### Decision
**Propose Razorpay as the primary India-first billing provider** supporting INR subscriptions, domestic recurring mandates (UPI AutoPay / e-mandates), and GST invoicing workflows. Defer Stripe to Phase 4 global rollout. Mark provider-specific details (mandate reliability, fee schedules, GST automation) as requiring empirical validation prior to implementation.

### Alternatives Considered
1. **Stripe First**: Higher decline rates on domestic Indian cards and lack of seamless UPI AutoPay.
2. **Dual Gateway Launch**: Premature complexity.

### Consequences
- **Positive**: Aligns with domestic payment habits.
- **Negative**: Requires formal validation of API and webhook edge cases during Phase 4.

---

## ADR-006: Page DNA (PR #2) Selective Integration Strategy

### Status: Accepted
### Context
PR #2 (`feat/page-dna`) introduces comprehensive Bengali content profiling, enum validation, and safety presets, but was developed against flat JSON files (`data/profile.json`).

### Decision
**Keep PR #2 as an immutable reference implementation and selectively cherry-pick its UI components, validation schemas, and prompt generation algorithms into a dedicated multi-tenant integration branch (`feat/page-dna-saas-integration`)**. Canonicalize roles to `owner`, `admin`, `editor`, `reviewer`, `viewer`.

### Alternatives Considered
1. **Direct Rebase of PR #2**: Massive merge conflicts with PostgreSQL repository layer.
2. **Discard PR #2**: Wastes valuable domain modeling and Bengali enum work.

### Consequences
- **Positive**: Preserves validated domain logic while eliminating flat file technical debt.
- **Negative**: Requires manual cherry-picking of UI and validator functions.

---

## ADR-007: Two-Phase CLI Migration & Formal PR Review Sequence

### Status: Accepted
### Context
Existing single-tenant users have data stored across `data/settings.json`, `data/users.json`, `data/queue.json`, `data/history.json`, and local media files.

### Decision
Implement a **standalone CLI migration runner with mandatory preflight checks, dry-run simulation, pre-migration snapshotting, transactional apply, and automated rollback runbooks**. Legacy data is seeded into a single default workspace. Establish a **formal PR review sequence** with clear statuses (`Draft`, `Reviewed`, `Staging validated`, `Approved for merge`, `Merged`), with no automated merging of PR #1.

### Alternatives Considered
1. **Automatic Boot Migration**: High risk of data corruption or duplicate records on restart.
2. **Immediate Merge of PR #1**: Violates staged review governance.

### Consequences
- **Positive**: Zero production data loss, full operator control, verifiable audit trail.
- **Negative**: Requires brief maintenance window during migration execution.

---

## ADR-008: URL-Scoped Workspace Context & Anti-Body-Tampering

### Status: Accepted
### Context
Multi-tenant applications often suffer from ambient tenant confusion or parameter tampering when tenant IDs are accepted interchangeably from request bodies, headers, or session states.

### Decision
Adopt **canonical URL-scoped routing** for all tenant-specific resources:
`/api/v1/workspaces/:workspaceId/...`
User authentication (session/cookie/token) establishes identity (`req.user`). The URL parameter establishes tenant context (`req.params.workspaceId`).

**Anti-Tampering Rule**: Request bodies must NEVER contain `workspaceId` or `workspace_id`. If supplied, requests are immediately rejected with `400 Bad Request` (`VALIDATION_FAILED`).

**Anti-Enumeration Rule**: Accessing non-existent resources or foreign workspace resources returns an identical `404 Not Found` (`WORKSPACE_NOT_FOUND`) response shape, completely blinding attackers to tenant presence.

### Alternatives Considered
1. **Body-supplied workspaceId**: Vulnerable to client-side injection and confused-deputy attacks.
2. **Session-stored current workspace**: Causes race conditions in multi-tab workflows.

### Consequences
- **Positive**: Strict, deterministic isolation; transparent audit logging; zero multi-tab collision.
- **Negative**: Client applications must construct URLs with workspace IDs explicitly.

---

## ADR-009: PostgreSQL Repository Strategy with Standard UUIDv4

### Status: Accepted
### Context
Choosing an identifier generation strategy and repository pattern. In-process monotonic counters for UUIDv7 implementations in Node.js introduce vulnerabilities around clock rollback, sequence overflow/wrap under concurrent loads, and reliance on extensions like `pgcrypto` or `uuid-ossp`.

### Decision
Adopt a **lean, explicit repository layer using `pg.Pool`** and **native RFC 4122 UUIDv4 identifiers via Node.js `crypto.randomUUID()`**:
1. Every repository method strictly uses parameterized queries (`$1, $2, ...`). Zero raw string interpolation is permitted.
2. Tenant queries must explicitly require `workspaceId` as a mandatory parameter.
3. `crypto.randomUUID()` leverages native OS CSPRNG with zero sequence state, eliminating clock-skew and sequence-wrapping vulnerabilities.
4. Tables use the native PostgreSQL `UUID` type, eliminating external extension requirements or elevated superuser privileges.

### Alternatives Considered
1. **Custom Monotonic Counter UUIDv7**: Prone to sequence wrap on high concurrency bursts and clock rollbacks.
2. **Heavy ORM (Prisma/TypeORM)**: High runtime overhead, complex multi-tenant query interception, and opaque query generation.
3. **Sequential Serial/BigInt**: Exposes total entity count and enables resource enumeration attacks.

### Consequences
- **Positive**: Zero sequence wrap vulnerability, complete extension independence, robust cryptographic randomness, and full control over query execution.
- **Negative**: Requires authoring explicit SQL queries and repository methods.

---

## ADR-010: One-Workspace-Per-Facebook-Page MVP Rule

### Status: Accepted
### Context
A Facebook Page represents a distinct brand, business, or creator presence. Allowing multiple workspaces to independently schedule and publish to the same Facebook Page creates conflicting token lifecycles, race conditions in queue processing, and duplicate posts.

### Decision
Enforce a **strict 1:1 relationship between an active Facebook Page and a workspace for MVP**. A Facebook Page may belong to exactly one active workspace at any given time. If a user attempts to connect a Page already owned by another workspace, the operation fails with a privacy-safe generic conflict (409) without leaking the competing workspace's identity.

### Alternatives Considered
1. **Shared Multi-Workspace Ownership**: Requires complex collaborative permission layers across distinct billing accounts.

### Consequences
- **Positive**: Prevents conflicting schedule executions and simplifies Meta webhook routing.
- **Negative**: Agencies managing a brand on behalf of an owner must be invited into the brand's workspace rather than connecting the page into their own workspace.

---

## ADR-011: India-First Billing Deferred to Phase 4

### Status: Accepted
### Context
The SaaS launch market focuses on India-first Bengali creators, coaching centres, restaurants, and small agencies. Implementing billing infrastructure (Razorpay) before core multi-tenancy and page management creates unnecessary surface area and blocks foundational stabilization.

### Decision
**Defer Razorpay billing, subscription state machines, and webhook reconciliation strictly to Phase 4**. Phase 1 implements only the database schema and RBAC permission definitions (`billing:read`, `billing:manage`), without introducing external billing SDKs or live network dependencies.

### Alternatives Considered
1. **Early Billing Integration in Phase 1**: Increases risk of broken payment flows while multi-tenant architecture is still evolving.

### Consequences
- **Positive**: Keeps Phase 1 lean, focused on PostgreSQL stability, and completely verifiable offline.
- **Negative**: Paid subscription enforcement is unavailable until Phase 4.

---

## ADR-012: Legacy Storage Compatibility Boundary & Dual-Mode Runtime Flag

### Status: Accepted
### Context
The existing single-tenant application runs on flat JSON files (`data/settings.json`, `data/users.json`, etc.). Introducing PostgreSQL must not break existing installations or regression test suites during the transition phase.

### Decision
Implement a **controlled runtime mode flag**: `STORAGE_MODE=legacy|postgres`:
1. `STORAGE_MODE=legacy` (default): Existing routes and legacy services continue functioning against JSON files without requiring PostgreSQL.
2. `STORAGE_MODE=postgres`: Enables PostgreSQL connection pool, URL-scoped workspace routes, and strict relational persistence.
3. **Fail-Closed Rule**: When `STORAGE_MODE=postgres` is set in production, `DATABASE_URL` is mandatory; missing configuration halts boot immediately with zero silent fallback to legacy storage.
4. **Zero Production Mutation**: Phase 1 does not mutate existing production JSON files.

### Alternatives Considered
1. **Immediate Hard Cutover**: Would immediately break existing tests and deployments before full end-to-end multi-tenant parity is reached.

### Consequences
- **Positive**: 100% backward compatibility preserved; legacy tests (49/49) pass without modification; zero downtime risk.
- **Negative**: Requires maintaining dual storage interfaces during the migration transition.

---

## ADR-013: Canonical Membership Lifecycle & Verified Invitation Acceptance

### Status: Accepted
### Context
Workspace memberships must preserve auditability when members depart while preventing ambient access. Furthermore, open invitation acceptance without email verification allows unintended users with possession of a forwarded invite link to claim seats.

### Decision
1. Canonicalize membership statuses to exactly three values:
   - `active`: Normal workspace access.
   - `suspended`: Relationship retained, access denied.
   - `removed`: Historical record retained for audit, access denied. Reactivatable only via explicit invitation or admin action.
2. Member deletion performs soft removal (`status = 'removed'`), maintaining foreign key referential integrity in audit logs.
3. Require verified email binding on invitation acceptance: the accepting user's account must have `email_verified_at IS NOT NULL` and `email_normalized` matching the invitation.
4. Bound invitation TTL strictly between 1 and 168 hours (default 72 hours).
5. Serialize membership mutations via row-level workspace locking (`SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`).

### Alternatives Considered
1. **Hard DELETE on Membership Removal**: Breaks audit log foreign key references and eliminates historical attribution.
2. **Unbound Invitation Acceptance**: Allows seat hijacking via forwarded tokens.

### Consequences
- **Positive**: Cryptographically tight invitation workflows, zero orphan records, clean audit trails.
- **Negative**: Unverified users must verify email before joining workspaces.

---

## ADR-014: Complete Active-Principal Verification & Canonical Lock Ordering

### Status: Accepted
### Context
Authorizing tenant access solely via membership table rows left vulnerabilities where suspended or soft-deleted users, or members of suspended, paused, or soft-deleted workspaces, could continue accessing or mutating tenant resources. Furthermore, concurrent transactions touching multiple tables risked deadlocks without a rigidly enforced lock acquisition order.

### Decision
1. **Complete Active-Principal Verification**: All workspace child endpoints and transactional mutations require:
   - `users.status = 'active'` AND `users.deleted_at IS NULL`
   - `workspaces.status = 'active'` AND `workspaces.deleted_at IS NULL`
   - `workspace_members.status = 'active'`
   Inaccessible or inactive resources return uniform, privacy-safe 404 responses.
2. **Canonical Lock Ordering**: Multi-table transactions must acquire table locks in this deterministic hierarchy:
   `1. workspaces` -> `2. workspace_invitations` -> `3. workspace_members` -> `4. users`
3. **Issuing Inviter Ongoing Authority**: When an invitation is accepted, re-verify that the inviter retains administrative authority (`role IN ('owner', 'admin')`, active user status, active membership). If the inviter lost authority or was removed, the invitation cannot be accepted.
4. **Member Removal Revocation**: Removing an active or suspended member atomically revokes all pending invitations for that member.
5. **Safe Removed-Member Reactivation**: When a previously removed member accepts a new authorized invitation, reactivate their existing membership row (`status = 'active'`) rather than failing on unique constraint.
6. **Anti-Self-Reactivation**: Suspended members are prohibited from self-reactivating via invitations.

### Alternatives Considered
1. **Membership-Only Checks**: Fast, but allows suspended or deleted users/workspaces to retain ambient access.
2. **Dynamic Lock Ordering**: Increases transaction deadlock risk under concurrent write loads.

### Consequences
- **Positive**: Complete tenant isolation, zero ambient access for inactive entities, guaranteed deadlock freedom.
- **Negative**: Adds joined active-principal checks to membership lookups.

---

## ADR-015: Strict Authentication Boundaries, Safe Error Sanitization & Loopback Safety Guard

### Status: Accepted
### Context
Test-mode identity headers (`x-test-user-id`) risked leaking into production or development if not strictly bounded. Legacy operator routes (`/settings`, `/queue`, `/media`, etc.) risked exposure to ordinary SaaS users. Uncaught exceptions or database syntax errors risked leaking sensitive query details, system paths, or secret tokens. Test runners risked running against live or cloud databases if misconfigured.

### Decision
1. **Strict Test Header Gating**: Header `x-test-user-id` is honored ONLY when `process.env.NODE_ENV === 'test'`. In `production`, `development`, or unset environments, it is ignored and unauthenticated requests fail with 401 `UNAUTHORIZED`.
2. **Legacy Route Isolation Boundary**: Legacy operator endpoints (`/settings`, `/queue`, `/media`, `/facebook`, `/automation`, `/ai`, `/templates`, `/status`, `/stats`, `/history`, `/events`, `/post`) are strictly guarded with `requireRole(['admin', 'super_admin'])`. Ordinary SaaS users (`role: 'user'`) receive 403 `FORBIDDEN_ROLE`.
3. **Centralized Async Error Handling**: Workspace route handlers are wrapped with `asyncHandler`. Domain errors map to typed, allowlisted codes (`AUTH_REQUIRED`, `WORKSPACE_NOT_FOUND`, `PERMISSION_DENIED`, `VALIDATION_FAILED`, `CONFLICT`, `INVITATION_INVALID`). Unexpected errors return generic 500 `InternalError` with zero leakage of database syntax, file paths, or injected canaries.
4. **WHATWG Loopback Safety Guard**: Dedicated module `db/safety-guard.js` parses connection strings using WHATWG URL standards, rejecting non-loopback hostnames (`127.0.0.1`, `localhost`, `::1`), deceptive hostnames, cloud providers (AWS, RDS, Neon, Supabase), and cloud query parameters. Credentials are sanitized via `redactDatabaseUrl`.
5. **Honest Authentication Status**: Document that session cookies with PBKDF2 password verification are fully operational for PostgreSQL users; migration of the legacy single-operator `/api/auth/login` endpoint to unified PostgreSQL/Redis multi-tenant authentication is scheduled for Phase 2.
6. **Reusable Clean-Worktree Verification**: Hardened runner `scripts/verify-clean-worktree.sh` enforces zero dirty files, lint, encoding, and 100% test pass rate across all suites, with self-testing `--test-failure-mode`.

### Alternatives Considered
1. **Direct Exception Forwarding**: Leaks internal database schema and SQL syntax to clients.
2. **Permissive Header Authentication**: High risk of privilege spoofing in non-test environments.

### Consequences
- **Positive**: Zero secret or canary leakage, robust defense-in-depth, strict separation of legacy and SaaS domains.
- **Negative**: Requires maintaining explicit role boundaries during Phase 1.

