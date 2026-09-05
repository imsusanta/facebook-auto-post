# Phase 2 — Database and backend

Repository implementation checklist. Deployment/live data migration is separate and must be explicitly run against your configured database after backup and staging review.

- [x] Replace shared JSON runtime storage with PostgreSQL; explicit legacy importer instead of automatic first-user ownership.
- [x] Users, workspaces and owner/editor/viewer memberships with relational keys.
- [x] Workspace ownership for page connections, post history, jobs, templates, media and automation rules. Repository queries use authenticated workspace context and bound SQL parameters.
- [x] Every **new** post-history record, scheduled job and ingested webhook job has a validated Facebook Page ID; composite foreign keys prevent cross-workspace page references. Destination/ownership changes are rejected by database triggers.
- [x] Versioned transactional migrations, applied-file checksums, status command, due-job/history/media/audit indexes and schema readiness checks.
- [x] Customer-specific SSE across processes via PostgreSQL LISTEN/NOTIFY; credentials redacted, notifications deferred until commit, large payloads replaced with refresh signals.
- [x] Central environment loading, PostgreSQL pool/timeouts, verified TLS policy, application origin and startup validation.

## Upgrade/deployment steps

1. Back up the existing PostgreSQL database (if phase 1 was deployed), legacy JSON files/media, and encryption key. Stop automation while upgrading.
2. Configure the new environment variables from `.env.example`. Production requires `DATABASE_SSL=require`; configure a trusted `DATABASE_CA_FILE` when your provider requires one. Remove SSL settings from the database URL so they cannot override certificate validation.
3. Run `npm ci`, then `npm run db:status`. A pending migration makes this command exit nonzero intentionally.
4. Run `npm run db:migrate`, then `npm run db:status`. Both migrations must report `applied`; never edit an applied migration to fix production data.
5. Build/start the application. `/healthz` reports process liveness; `/readyz` reports schema/database readiness and returns 503 when migrations are pending, unknown or changed.
6. If importing legacy JSON, follow `SECURITY_SETUP.md`. Supply the reviewed destination for **both history and queue entries** that lack an explicit Page ID. Existing `facebookPageId` values are checked, not silently overwritten. Import preserves supplied history timestamps and leaves automation disabled.
7. Verify tenant isolation, page connections, publishing and backup restore in staging before enabling automation or merging/deploying to production.

## Migration safety and historical data

`001_security_foundation.sql` remains unchanged. `002_backend_integrity.sql` adds relational job/history/webhook page fields, indexes and immutable ownership/destination constraints. Databases created by the earlier runner receive a checksum baseline for existing migrations; subsequent changes are rejected. Unknown newer migrations also make an older application fail readiness.

Existing phase-1 history with no valid owned page cannot be truthfully assigned to a page. It is preserved as `legacy_unattributed=true` with a null relational page reference, and returned to clients as `legacyUnattributed`. No active-page guess is made. New application writes reject missing/foreign pages. A separate reviewed data-repair migration is required to resolve historical exceptions; the ordinary API cannot reassign history.

Disconnecting a page now clears its token and marks the connection disconnected instead of deleting the ownership row. This preserves history/webhook foreign keys. Reconnection is available within the same workspace; transferring a page between workspaces needs a deliberate future ownership-transfer workflow. Existing queued rows must be removed/reviewed before disconnecting.

## Query/data model

Identity, ownership, job status/scheduling and history timestamps are relational columns. Content/template/rule payloads remain JSONB for compatibility with the existing frontend. This is not a return to shared filesystem JSON storage.

Due-job selection runs in SQL using the pending-job index. Read/modify/write repository operations remain serialized per workspace through transaction-scoped advisory locks. There is no per-customer PostgreSQL login or blanket claim of database row-level security; the application owns the connection and enforces scope in its repository/API layer, reinforced by foreign keys and immutable ownership triggers.

## Shared SSE behavior

Each server listens on the same PostgreSQL notification channel. Envelopes include a workspace identifier and process source ID; clients only receive their own workspace's redacted events. Session/member revocations propagate to other instances. A rolled-back transaction emits no notification. Large updates carry `state_invalidated` instead of exceeding PostgreSQL's notification limit. Clients refetch their authenticated state on connection/resync.

LISTEN/NOTIFY is **not** durable event storage. Missed notifications are recovered through state refresh, not replay. A reconnecting broker triggers local resync; slow clients are disconnected rather than accumulating unbounded buffers. This verifies shared notification plumbing, not full multi-replica scheduler or deployment readiness. Media still needs persistent/shared storage for multi-instance deployments.

## Local validation

The regression suite covers fresh schema use, the 001→002 upgrade, migration idempotence/checksums/readiness, relational page ownership, immutable destinations, SQL due-job lookup, disconnect/history retention, transactional SSE and a separate Node process publishing to a workspace-scoped SSE connection, alongside the existing security tests.

Run against a dedicated database ending in `_test`:

```sh
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/autopost_test npm test
npm run check
npm run build:css
npm audit --omit=dev
```

Live database migration, real Meta/Gemini/email delivery and production operational acceptance are not performed by committing this code.
