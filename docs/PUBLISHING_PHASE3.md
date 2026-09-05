# Phase 3 — publishing reliability

Implemented on the security/database feature branch. This is code and local/CI validation, **not a production deployment or a complete SaaS certification**. Hosting setup is intentionally deferred.

## Implemented checklist

- Queue **Publish Now** and manual/AI publishing call one publishing service, with honest `published` responses.
- Every durable job keeps an immutable owned Facebook Page ID. Page switching does not redirect queued posts; autopilot has its own saved destination.
- Atomic per-row writes, workspace transactions and lease claims replace whole-queue read/modify/write execution.
- PostgreSQL jobs, operation intents, attempt audit records and cron slots survive process restarts.
- Safe failures retry with exponential backoff, jitter and `Retry-After`. Default budget: five attempts.
- Idempotency keys and fenced claims prevent repeated delivery of the **same operation**. Confirmed history is inserted once per job.
- Expired workers are recovered conservatively; uncertain Facebook delivery is quarantined as `needs_review`.
- IANA timezone scheduling converts local times to a persisted UTC instant. Ambiguous/nonexistent DST times are rejected rather than guessed.
- Missing credentials/demo mode cannot claim a real publication; Meta must return a real post ID.
- Gemini generation errors fail closed. Canned topics/captions, random stock-pool substitution and blank-image success are removed. A failed photo request is never downgraded into an unexpected text-only post.

## State machine and delivery semantics

`pending → processing → completed | retry_wait | failed | needs_review`

- Claims acquire a unique lease, valid for 120 seconds and renewed every 30 seconds. Checkpoints, dispatch and completion require the current unexpired lease.
- Preparation (credentials, AI, media) happens before a persisted dispatch marker. Generated content is checkpointed and reused on safe retries.
- **Safe retry:** explicit Meta 4xx transient/rate-limit rejection or a classified connection failure before delivery. Backoff starts at 30 seconds, doubles to a 1-hour base cap, adds up to 20% jitter, and honors `Retry-After` up to 24 hours.
- **Permanent failure:** missing credentials, demo mode, invalid/permission rejection, or exhausted budget. `POST /api/queue/:id/retry` only requeues definitively failed jobs with remaining budget after the underlying issue is fixed.
- **Uncertain delivery:** timeout, connection reset, HTTP 5xx, missing provider post ID, or worker interruption after the dispatch marker. No automatic or ordinary manual retry is allowed. A late provider success is retained in the attempt audit without letting a stale worker overwrite current job state.
- A worker interrupted before dispatch can retry after lease expiry plus a 30-second delay; interrupted legacy processing rows become `needs_review` during migration.

**This does not promise exactly-once delivery across the database and Facebook.** They do not share a transaction, and this integration does not assume a provider idempotency guarantee. The safe trade-off is manual review when delivery is uncertain, including rare cases where a dispatch marker committed but no request actually left the process.

### Needs-review procedure

1. Open the job's recorded Facebook Page, not whichever page is currently selected in the app.
2. Check the content and time against actual Facebook posts and any provider receipt in `publication_attempts`.
3. If already published, do not create another post. Keep the audit record; a dedicated reconciliation UI is not included in this phase.
4. If absence is positively confirmed and a retry is desired, an operator/user may deliberately create a **new** publication intent. Do not bulk-reset jobs or delete intent tombstones to force retries.

## API changes

Require a stable `Idempotency-Key` (16–128 characters, letters/numbers/colon/underscore/hyphen) for:

- `POST /api/post` (also `/api/facebook/post`)
- `POST /api/queue`
- `POST /api/ai/autopilot/trigger`
- `POST /api/automation/run-now`

Keep the same key and payload when retrying a network request. A reused key with changed content, destination, schedule or options returns 409. Deleting a queued job does not delete its intent tombstone; a completed job retains its receipt. Keys are scoped to a workspace, not shared across customers. Image identity uses the normalized media content hash.

New keys represent new deliberate operations; identical text with different keys **can** publish again. The browser stores non-secret operation keys per tab/workspace, preserves them across network failures, and asks for confirmation before a repeat accepted/completed operation. It is not a global semantic duplicate detector across tabs, devices or accounts.

Responses:

- `200, published:true`: Facebook post ID confirmed (or replayed confirmed receipt).
- `202, published:false`: saved/in progress/waiting for safe retry; **not yet published**.
- `409, published:false`: failed or requires review.
- `410`: intent refers to a removed, uncompleted job; no new delivery.
- Queue creation returns `success:true` for durable acceptance only; it is not publication confirmation.

Read a job with `GET /api/queue/:id`. Existing queue IDs are the operation identity for `POST /api/queue/:id/publish-now`; no new operation is created. Publish Now can bring a future job forward, but **never bypasses retry backoff**. Its subsequent safe retries stay eligible even if the original scheduled time was later.

## Timezones and recurring autopilot

In Settings, choose an IANA timezone (for example `Asia/Kolkata`) and the dedicated autopilot Page ID. Existing installations default to UTC, not the server's local timezone.

For one-off jobs send either:

```json
{"scheduledLocal":"2030-09-05T13:45","timeZone":"Asia/Kolkata"}
```

or an explicit-offset `scheduledAt`, such as `2030-09-05T08:15:00Z`. Never send a timezone-less instant. Changing workspace timezone does not move existing scheduled jobs.

Cron expressions must have five fields. Autopilot saves its cron, timezone, page, revision and next run in PostgreSQL. A page switch alone cannot redirect it. Concurrent workers materialize only one intent per persisted slot. After downtime, missed slots coalesce into **one catch-up post**, not a flood of historical publications; future slots continue normally. Editing/re-enabling the schedule starts the next future slot.

Workspace `autoPostEnabled` controls automatic scheduled queue processing; `autoPilotEnabled` controls recurring AI scheduling. Explicit Publish Now/manual AI requests keep their own retry intent and are not silently cancelled by these recurring-automation toggles. The process-level `ENABLE_AUTOMATION=false` still disables background polling entirely.

## Deployment later — required prerequisites

1. Back up PostgreSQL, media and the stable encryption key. Stop old app/worker processes before migrating; an old dispatcher must not keep publishing during the upgrade.
2. Install with `npm ci`; run `npm run db:migrate` and `npm run db:status`. All three migrations must be applied. Migrations 001/002 remain unchanged; 003 adds the durable publishing schema.
3. Use PostgreSQL 16+, the same `DATABASE_URL` and encryption key across processes, and **persistent shared media storage accessible at the same `DATA_ROOT`**. The current filesystem media layer is not object storage. Separate hosts without a shared/persistent volume are not a supported production topology yet.
4. For a single always-on Node process, `ENABLE_AUTOMATION=true npm start` includes polling. For a separate publishing worker, run `ENABLE_AUTOMATION=true npm run worker`; web instances can use `ENABLE_AUTOMATION=false`. Multiple worker processes are fenced by PostgreSQL claims.
5. Choose one webhook-processing topology separately. `ENABLE_WEBHOOKS` also controls webhook startup and requires the configured app secret/verification token; separating webhook acceptance from processing flags is not part of this phase.
6. Monitor worker process health, retry backlog, oldest due jobs, `needs_review`, database connectivity and disk/media capacity. A sleeping web process does **not** execute jobs on time just because the queue is durable.
7. Run controlled Meta/Gemini staging tests and backup/restore checks before enabling production automation. Account permissions, token validity, app review and provider/API-version compatibility still need real validation.

Keeping Hostinger Unlimited is a hosting choice, not proof that an always-on worker/shared PostgreSQL/media topology is available. No Hostinger, Supabase, external worker, billing account or production environment has been created or configured by this change.

## Validation

```sh
npm run check
npm run build:css
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/autopost_test npm test
npm audit --omit=dev --audit-level=high
```

Tests use an isolated database ending `_test` and mocked Meta/Gemini/SMTP. Coverage includes concurrency, idempotency, tenant isolation, immutable destinations, retry/backoff/budget, uncertain delivery, image handling, AI failure, DST, persisted cron slots, migration upgrades, a worker process that exits mid-job, stale-worker fencing and standalone worker startup/shutdown. They do not make real Facebook posts.

Remaining broader SaaS work includes billing/plans, OAuth onboarding, quotas/abuse controls, provider validation, operational monitoring and production acceptance. This phase does not claim those are complete.
