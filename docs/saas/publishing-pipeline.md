# Gate 5: Durable Publishing Pipeline & Worker Architecture

## 1. Architectural Overview

The SaaS publishing pipeline provides **crash-resilient, exactly-once publishing semantics** for multi-tenant Facebook post scheduling. Built natively on PostgreSQL 16 using row-level locking (`FOR UPDATE SKIP LOCKED`), it eliminates external message broker dependencies (such as Redis or RabbitMQ) and provides 100% ACID transactionality between post creation/updates and publishing job dispatch.

```
+-------------------------------------------------------------------------------+
|                             PostgreSQL 16 Engine                             |
|                                                                               |
|  +----------------------+   Atomic Tx   +----------------------------------+  |
|  |   workspace_posts    | <===========> |      workspace_publish_jobs      |  |
|  | (caption, scheduled) |               |  (queued / locked / published)   |  |
|  +----------------------+               +----------------------------------+  |
|             ^                                            |                    |
|             | Idempotency Boundary                       | SKIP LOCKED        |
|             v                                            v                    |
|  +----------------------+               +----------------------------------+  |
|  | publish_idempotency  |               |    PublishingWorker Fleet        |  |
|  |  (unique key/status) |               | (Content Safety, Decrypt, Graph) |  |
|  +----------------------+               +----------------------------------+  |
|                                                          |                    |
|                                                          v                    |
|                                         +----------------------------------+  |
|                                         |     publish_attempts (Audit)     |  |
|                                         | (Telemetry Redaction: 0 Secrets) |  |
|                                         +----------------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## 2. Core Subsystems

### 2.1. Transactional Outbox Pattern
When a post is scheduled or triggered for immediate publishing via `POST /api/v1/workspaces/:wsId/posts/:postId/publish-now`:
1. The post row is locked and validated for workspace containment.
2. An outbox job is created in `workspace_publish_jobs` in the **exact same database transaction**.
3. An entry is registered in `workspace_publish_idempotency` with a unique constraint `UNIQUE (workspace_id, idempotency_key)`.
4. If the database transaction rolls back for any reason, neither the post modification nor the publishing job is persisted, preventing ghost executions.

### 2.2. Concurrent Worker Claiming (`FOR UPDATE SKIP LOCKED`)
Workers claim available jobs using standard PostgreSQL row-level locking:
```sql
SELECT id, workspace_id, post_id, workspace_page_id, idempotency_key, retry_count, max_retries
FROM workspace_publish_jobs
WHERE status = 'queued' AND next_run_at <= NOW()
ORDER BY next_run_at ASC
LIMIT $1
FOR UPDATE SKIP LOCKED;
```
This guarantees that concurrent worker instances never contend, deadlock, or claim the same publishing job.

### 2.3. Ambiguous Provider Response Reconciliation
When calling the Meta Graph API (`POST /{page-id}/feed`), network timeouts, connection resets, or 502/504 Bad Gateway errors can occur *after* Facebook receives and executes the request.
Retrying blindly in such cases would create an embarrassing **duplicate wall post** on the customer's page.

**Reconciliation Algorithm**:
1. If a job fails due to an ambiguous timeout (`ETIMEDOUT`, `ECONNRESET`, 502/504), its attempt status is marked `ambiguous`.
2. On the subsequent retry, the worker executes a **feed reconciliation check**:
   - Queries Meta Graph API `GET /{page-id}/feed?fields=id,message,created_time&limit=10`.
   - Checks if a post with matching caption was created within the last 15 minutes.
3. If discovered on Facebook:
   - Marks the job as `published` and records the found `fb_post_id`.
   - Skips sending a duplicate publish request.
4. If verified not present:
   - Proceeds with normal publishing.

### 2.4. Exponential Backoff with Jitter
For retryable errors (Meta rate limits `code 32`, `code 613`, transient 5xx, or network drops), the worker calculates backoff:
$$\text{delay} = \min\left(\text{base} \times 2^{\text{retry} - 1} + \text{jitter}, 3600\right)$$
- `retry_count` is incremented.
- `next_run_at` is set to `NOW() + delay`.
- Status remains `queued`.

### 2.5. Dead-Letter Queue (DLQ) & Non-Retryable Error Handling
- **Max Retries Exceeded**: When `retry_count >= max_retries` (default 5), the job transitions to `dead_letter` and the parent post is marked `failed`.
- **Non-Retryable Errors**: Errors such as token revocation (`code 190`), permission errors (`code 200`), page not found, or content safety violations **immediately abort** to `dead_letter` on attempt 1 without wasting API quota.

### 2.6. Stale Worker Crash Recovery
If a worker crashes mid-execution while holding a job in `locked` or `publishing` state:
- The periodic recovery sweep queries jobs where `locked_at < NOW() - INTERVAL '5 minutes'`.
- Safely resets `status = 'queued'` and clears `locked_at` and `locked_by`.

### 2.7. Telemetry Redaction & Zero Secret Leakage
The `workspace_publish_attempts` table records full diagnostics for operational monitoring.
- The `sanitizeSecretStrings` filter strips all Facebook tokens (`EAAB...`, `EAA...{15,}`) and replaces them with `[REDACTED_FB_TOKEN]`.
- Tokens are decrypted strictly in-memory during Graph API dispatch.

### 2.8. Circuit Breaker
If a page accumulates 5 consecutive authorization or rate limit errors within 5 minutes:
- The circuit breaker trips for that `workspace_page_id`.
- Subsequent jobs for that page are deferred with `CIRCUIT_BREAKER_ACTIVE` to prevent spamming Meta's API and triggering account bans.

---

## 3. RBAC Matrix for Publishing

| Permission | Owner | Admin | Reviewer | Editor | Viewer | Purpose |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `publish:trigger` | [x] | [x] | [x] | [x] | [ ] | Immediate outbox job dispatch |
| `publish:retry` | [x] | [x] | [ ] | [ ] | [ ] | Manual retry of dead-lettered jobs |
| `schedule:cancel` | [x] | [x] | [x] | [ ] | [ ] | Cancel queued publish jobs |
| `drafts:read` | [x] | [x] | [x] | [x] | [x] | View publish job status & logs |

---

## 4. API Endpoints

- `POST /api/v1/workspaces/:wsId/posts/:postId/publish-now` (`publish:trigger`): Enqueues an immediate publishing outbox job. Returns HTTP 202 Accepted.
- `GET /api/v1/workspaces/:wsId/publish-jobs` (`drafts:read`): Lists publishing jobs with pagination and status filters.
- `GET /api/v1/workspaces/:wsId/publish-jobs/:jobId` (`drafts:read`): Returns job details, current state, and full attempt history.
- `POST /api/v1/workspaces/:wsId/publish-jobs/:jobId/cancel` (`schedule:cancel`): Cancels a queued job and reverts post status to `draft`.
- `POST /api/v1/workspaces/:wsId/publish-jobs/:jobId/retry` (`publish:retry`): Manually re-queues a failed or dead-lettered job.
