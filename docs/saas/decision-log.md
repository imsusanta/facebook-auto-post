# Architecture Decision Log (ADR)

## 1. Overview

This document records the foundational architectural decisions made during Phase 0 of the SaaS transformation. Each Architecture Decision Record (ADR) captures the context, decision, trade-offs, and compliance criteria for critical structural choices.

```
+-----------------------------------------------------------------------------+
|                                ADR Summary                                  |
+---------+-----------------------------------------------------+-------------+
| ADR ID  | Title                                               | Status      |
+---------+-----------------------------------------------------+-------------+
| ADR-001 | Multi-Tenancy Strategy (Shared DB + Workspace ID)   | Accepted    |
| ADR-002 | Session Management via Redis Opaque Bearer Tokens   | Accepted    |
| ADR-003 | Meta OAuth 2.0 and 1:1 Facebook Page Ownership      | Accepted    |
| ADR-004 | Distributed Job Processing with BullMQ and Redis    | Accepted    |
| ADR-005 | India-First Billing Launch Provider (Razorpay)      | Accepted    |
| ADR-006 | Page DNA (PR #2) Selective Integration Strategy     | Accepted    |
| ADR-007 | Two-Phase Preflight / Dry-Run / Apply Migration     | Accepted    |
+---------+-----------------------------------------------------+-------------+
```

---

## ADR-001: Multi-Tenancy Strategy (Shared Database with Row-Level Scoping)

### Status: Accepted
### Context
The existing application stores all settings, users, queue, and history in single-tenant JSON files. We need an isolation model that supports hundreds of small businesses (coaching centres, restaurants, boutiques) and agencies cost-effectively while guaranteeing complete data isolation.

### Decision
Adopt a **shared PostgreSQL database with logical row-level tenant scoping** (`workspace_id` column on all tenant-owned tables) combined with PostgreSQL Row Level Security (RLS) and strict repository-level query predicates.

### Alternatives Considered
1. **Database-per-Tenant**: Dedicated PostgreSQL database for each customer.
   - *Rejected*: Massive operational overhead, costly connection pooling, slow schema migrations across hundreds of databases.
2. **Schema-per-Tenant**: Separate PostgreSQL schema for each workspace.
   - *Rejected*: PostgreSQL connection cache bloat, complex cross-tenant migrations, high DDL latency.

### Consequences
- **Positive**: Cost-efficient resource utilization, simplified cross-tenant analytics and backups, single migration pipeline.
- **Negative**: Requires strict developer discipline and automated tests to ensure `workspace_id` is present in every query.
- **Compliance**: Automated CI tests enforce `workspace_id` filtering on all repository methods.

---

## ADR-002: Session Store and Authentication via Redis Opaque Bearer Tokens

### Status: Accepted
### Context
Currently, sessions are stored in an in-memory JavaScript `Map` inside `createApp.js`, which is destroyed on process restart. We need a horizontally scalable, persistent session mechanism that supports multi-workspace context and instant revocation.

### Decision
Use **Redis-backed opaque bearer sessions storing SHA-256 token digests**. Raw tokens (256-bit crypto-random) are delivered to clients via `HttpOnly`, `SameSite=Lax`, `Secure` cookies. Redis stores `session:{sha256(token)}` with dual timeout (30-day absolute, 24-hour idle).

### Alternatives Considered
1. **Stateless JWTs**: Self-contained tokens signed with asymmetric keys.
   - *Rejected*: Cannot be instantly revoked upon membership removal, password reset, or compromised account without complex distributed blocklists.
2. **PostgreSQL Session Store**: Storing active sessions in a relational table.
   - *Rejected*: High database write load for updating `last_active_at` on every request.

### Consequences
- **Positive**: Instant revocation cascades across devices, rapid sub-millisecond session validation, dynamic active workspace switching.
- **Negative**: Adds Redis as a hard dependency for authentication (requires high-availability Redis Sentinel/Cluster).
- **Compliance**: Auth middleware enforces fail-closed behavior during Redis outages.

---

## ADR-003: Meta OAuth 2.0 and 1:1 Facebook Page Ownership

### Status: Accepted
### Context
Currently, Facebook credentials consist of a single `PAGE_ACCESS_TOKEN` and `PAGE_ID` pasted into `.env`. Users cannot authenticate dynamically or connect their own pages.

### Decision
Implement **Meta OAuth 2.0 flow with HMAC-signed state parameters and long-lived token exchange**. Enforce a **strict 1:1 ownership rule**: a Facebook Page ID can be actively connected to exactly one workspace at any given time. All tokens are encrypted at rest using AES-256-GCM envelope encryption.

### Alternatives Considered
1. **Multi-Workspace Shared Pages**: Allowing multiple workspaces to connect to the same Facebook Page simultaneously.
   - *Rejected for MVP*: Creates race conditions in scheduled posting, conflicting Page DNA tone profiles, and messy billing attribution. Deferred to future Agency Enterprise tiers.
2. **Plaintext Database Storage**: Storing page tokens directly in PostgreSQL columns.
   - *Rejected*: Fatal security liability if database dumps or SQL injection vulnerabilities occur.

### Consequences
- **Positive**: Clean ownership boundary, automated token exchange, zero token exposure in browser client, robust auditability.
- **Negative**: Users attempting to connect a page already connected to another workspace encounter a rejection that requires administrative transfer.
- **Compliance**: Unique database index on `facebook_page_id` enforces 1:1 ownership.

---

## ADR-004: Distributed Job Processing with BullMQ and Redis

### Status: Accepted
### Context
The current scheduler uses Node.js in-process `setTimeout` and `setInterval`. Jobs are lost on server crash or restart, and jobs cannot be scaled across multiple worker processes.

### Decision
Adopt **BullMQ backed by Redis for distributed background job processing**, with dedicated worker processes for publishing, analytics, and webhooks. Utilize **Redlock distributed locking** per Facebook Page and per scheduled post to prevent duplicate posts.

### Alternatives Considered
1. **PostgreSQL-based Queue (pg-boss / LISTEN-NOTIFY)**: Running queues inside PostgreSQL.
   - *Rejected*: High transaction write amplification and table bloat during high-frequency polling.
2. **Apache Kafka / RabbitMQ**: Heavy enterprise messaging brokers.
   - *Rejected*: Excessive operational overhead for current scale; Redis is already deployed for sessions.

### Consequences
- **Positive**: Guaranteed at-least-once delivery, exponential backoff with jitter, dead-letter queues, rate-limit throttling.
- **Negative**: Redis memory must be monitored to prevent job payload evictions (persistence via RDB/AOF required).
- **Compliance**: Reconciliation logic resolves edge-case network timeouts before retrying Graph API calls.

---

## ADR-005: India-First Billing Launch Provider (Razorpay)

### Status: Accepted
### Context
The application is targeted at Bengali creators, coaching centres, restaurants, and local businesses in West Bengal and India. We must select a launch billing provider that matches domestic payment habits.

### Decision
Select **Razorpay as the exclusive billing provider for the initial SaaS launch**. Defer Stripe integration to the subsequent global expansion phase.

### Alternatives Considered
1. **Stripe First**: Using Stripe as the primary gateway.
   - *Rejected*: Stripe India lacks friction-free UPI AutoPay recurring flows, suffers high decline rates on domestic RuPay/debit cards, and has stringent merchant onboarding requirements in India.
2. **Dual Gateway Launch (Stripe + Razorpay)**: Implementing both simultaneously.
   - *Rejected*: Doubles webhook integration, requires complex cross-gateway reconciliation, and delays time-to-market.

### Consequences
- **Positive**: Maximizes checkout conversion via UPI AutoPay, automated RBI e-mandate compliance, domestic GST invoices.
- **Negative**: Global customers outside India cannot pay via local currencies until Stripe is added in Phase 4.
- **Compliance**: Webhook handler enforces signature verification and PostgreSQL idempotency logging.

---

## ADR-006: Page DNA (PR #2) Selective Integration Strategy

### Status: Accepted
### Context
PR #2 (`feat/page-dna`) introduces comprehensive Bengali content profiling, enum validation, and safety presets. However, it was developed against a single-tenant flat JSON storage architecture (`data/profile.json`).

### Decision
**Keep PR #2 as an immutable reference implementation and selectively cherry-pick its UI components, validation schemas, and prompt generation algorithms into a dedicated multi-tenant integration branch (`feat/page-dna-saas-integration`)**.

### Alternatives Considered
1. **Direct Rebase of PR #2 onto PostgreSQL Branch**:
   - *Rejected*: Would result in massive merge conflicts across storage layers, since PR #2 deeply couples file reads with business logic.
2. **Discard PR #2 and Rewrite from Scratch**:
   - *Rejected*: Wastes significant effort invested in domain modeling, Bengali enum definitions, preset configurations, and UI controls.

### Consequences
- **Positive**: Eliminates file-based technical debt while preserving validated domain logic and UI work.
- **Negative**: Requires careful manual cherry-picking and adaptation of service functions to use PostgreSQL repositories.
- **Compliance**: Multi-tenant Page DNA must enforce `workspace_id` on all profile entities.

---

## ADR-007: Two-Phase Preflight / Dry-Run / Apply Migration Strategy

### Status: Accepted
### Context
Existing single-tenant users have data stored across `data/settings.json`, `data/users.json`, `data/queue.json`, `data/history.json`, and local media files. We need a safe migration path to PostgreSQL and S3.

### Decision
Implement a **standalone CLI migration runner with mandatory preflight checks, dry-run simulation, pre-migration snapshotting, transactional apply, and automated rollback runbooks**. All legacy single-tenant assets are seeded into a single canonical default workspace.

### Alternatives Considered
1. **Automatic On-Boot Migration**: Migrating flat files when the Node server boots.
   - *Rejected*: Extremely risky; server crashes during startup could corrupt state or lead to duplicate records.
2. **Manual SQL Scripts**: Hand-crafting SQL insert queries.
   - *Rejected*: Error-prone, lacks checksum validation, cannot safely encrypt legacy tokens into KMS envelope format.

### Consequences
- **Positive**: Operator maintains complete control; dry-run produces a verifiable mapping report before any data is written; zero production data loss.
- **Negative**: Requires downtime maintenance window during migration execution.
- **Compliance**: Migration runner CLI redacts all secrets from terminal output and log files.
