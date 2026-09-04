# Multi-Tenant SaaS Target Architecture

## 1. System Overview

The target SaaS transforms the single-operator automation tool into a multi-tenant, cloud-native content operating system designed specifically for Bengali-speaking businesses, coaching centres, restaurants, boutiques, and digital marketing agencies.

```
+-----------------------------------------------------------------------------+
|                             System Topology                                 |
+--------------------------+--------------------------------------------------+
| CURRENT (Single-Tenant)  | Flat JSON files in data/, volatile in-memory     |
|                          | sessions in middleware/auth.js, node-cron and    |
|                          | setInterval in services/scheduler.js             |
+--------------------------+--------------------------------------------------+
| TARGET (Multi-Tenant)    | PostgreSQL 16 (Relational/ACID), Redis HA        |
|                          | (Sessions & Queues), BullMQ worker service,      |
|                          | S3 object storage, multi-tab request context     |
+--------------------------+--------------------------------------------------+
| DEFERRED                 | Dedicated worker fleets per domain, Redis        |
|                          | Cluster sharding, multi-region database replicas |
+--------------------------+--------------------------------------------------+
```

---

## 2. Infrastructure Architecture: MVP vs Scale-Up

To avoid premature operational overhead, infrastructure is strictly right-sized:

```mermaid
flowchart TD
    subgraph ClientLayer [Client Layer]
        Browser[Client Browser Multi-Tab Safe]
    end

    subgraph MVP [MVP Production Environment]
        LB[Load Balancer TLS 1.3]
        API[1 Containerized API Service Node Express]
        Worker[1 Unified Worker Service BullMQ Consumer]
        PG[(1 Managed PostgreSQL 16 RDS / Cloud SQL)]
        Redis[(1 Managed Redis Persistent HA)]
        S3[(1 Private S3 Bucket Pre-Signed URLs)]
        KMS[Managed KMS Key Service]
    end

    subgraph ScaleUp [Scale-Up Deferred Architecture]
        RedisC[(Redis Cluster Sharded)]
        PubFleet[Dedicated Publishing Worker Fleet]
        AnaFleet[Dedicated Analytics Worker Fleet]
        WebFleet[Dedicated Webhook Worker Fleet]
        PGReplicas[(PostgreSQL Read Replicas)]
    end

    Browser --> LB
    LB --> API
    API -->|Write metadata & states| PG
    API -->|Read/Write session hashes| Redis
    API -->|Enqueue publishing jobs| Redis
    API -->|Issue pre-signed media URLs| S3

    Worker -->|Fetch jobs & acquire locks| Redis
    Worker -->|PostgreSQL idempotency boundary| PG
    Worker -->|Decrypt tokens via KMS DEK| KMS
    Worker -->|Publish content| Meta[Meta Graph API]

    MVP -.->|Scale after PMF| ScaleUp
```

---

## 3. Core Component Decomposition

### 1. Web & API Service (`api`)
- Stateless Express application behind an HSTS/TLS 1.3 load balancer.
- Authenticates users via Redis opaque sessions (SHA-256 token hashing).
- Resolves workspace context per-request (via URL `/api/v1/workspaces/:wsId/...` or `X-Workspace-Id` header).
- Validates active membership in `workspace_members` and enforces canonical RBAC roles (`owner`, `admin`, `editor`, `reviewer`, `viewer`).
- Enforces server-side plan entitlements before generating drafts or adding pages.

### 2. Scheduler Producer
- Integrated within the worker service (or leader-elected instance).
- Polls PostgreSQL `scheduled_posts` table for items due within the upcoming 60-second window.
- Dispatches jobs to Redis BullMQ with strict job payloads (`workspaceId`, `facebookPageId`, `scheduledPostId`, `idempotencyKey`).

### 3. Unified Worker Service (`worker`)
- Single containerized process running BullMQ consumers for:
  - **Publishing Queue**: Manages token decryption, S3 asset retrieval, PostgreSQL idempotency, Graph API rate-limit throttling, and post publication.
  - **Analytics Queue**: Asynchronously gathers reactions, shares, and comments.
  - **Webhook Queue**: Processes asynchronous Meta webhooks (feed updates, permission drops) and Razorpay billing webhooks.

### 4. Storage & Secret Services
- **PostgreSQL 16**: System of record for all entities. Enforces composite foreign keys `(workspace_id, parent_id)` to guarantee tenant isolation at the database layer.
- **Redis**: Fast volatile store for opaque session hashes, OAuth state hashes, BullMQ queues, and Redlock distributed locks.
- **S3 Object Storage**: Private storage for uploaded media assets. Access is restricted to 15-minute pre-signed URLs.
- **Cloud KMS**: Hardware-backed Key Management Service managing master Key Encryption Keys (KEK).

---

## 4. Multi-Tab-Safe Request Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User as Client Browser (Tab 1: Workspace A)
    participant API as API Server
    participant Redis as Redis Session Store
    participant PG as PostgreSQL

    User->>API: GET /api/v1/workspaces/ws-A/posts (Cookie: app_session=T)
    API->>API: Compute H = SHA-256(T)
    API->>Redis: GET session:{H}
    Redis-->>API: { user_id: usr-1, ... }

    API->>PG: SELECT role, status FROM workspace_members WHERE user_id = 'usr-1' AND workspace_id = 'ws-A'
    alt Not a Member or Status != 'active'
        PG-->>API: 0 rows
        API-->>User: 404 Not Found (Anti-Enumeration)
    else Active Member Verified (role = 'editor')
        PG-->>API: role = 'editor', status = 'active'
        API->>PG: SELECT * FROM content_posts WHERE workspace_id = 'ws-A'
        PG-->>API: Posts for Workspace A
        API-->>User: 200 OK { posts: [...] }
    end
```

### Multi-Tab Safety Guarantee
Because workspace authorization is evaluated strictly from the request path (`/api/v1/workspaces/:wsId/...`) or `X-Workspace-Id` header against the database on every request—and never stored as a mutable global field on the user session—users can manage multiple workspaces across separate browser tabs simultaneously without context interference.
