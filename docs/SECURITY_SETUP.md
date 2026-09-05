# Security + PostgreSQL foundation

This is a breaking infrastructure change from the original unauthenticated, shared-JSON application. Stage and review it before deploying. It does not complete billing, Meta OAuth/App Review, cloud media storage, or production reliability certification.

## What is implemented

### Phase 1 — security

- Signup, email verification, login/logout, and password reset. Passwords use Node's scrypt with random salts; one-time email tokens and opaque session tokens are stored as SHA-256 hashes.
- Seven-day HttpOnly, SameSite=Lax sessions; production uses a Secure `__Host-` cookie. CSRF tokens and exact-origin checks protect mutations.
- Verified accounts own separate workspaces. Owner/editor/viewer permissions are enforced on the server. Page credentials/settings and membership administration require the owner role.
- Customer Facebook/Gemini credentials are encrypted using AES-256-GCM. Credentials are write-only in the UI and redacted from API/SSE payloads. Upstream error objects, query strings and credential values are not logged.
- Workspace-scoped SSE, private media authorization, real image decoding/re-encoding, 8 MiB upload/input cap, 25-megapixel decode cap, and a default 256 MiB stored-media cap per workspace.
- Remote images require HTTPS and public IP destinations; DNS answers are validated and pinned. Redirects, proxy inheritance, arbitrary local paths, and cross-workspace media references are rejected.
- Locally served DOMPurify and icon assets, compiled Tailwind CSS, removal of inline executable scripts, CSP/Helmet headers, request schemas and PostgreSQL-backed rate limits.
- Meta HMAC-SHA256 verification against the raw request bytes before parsing; persistent deduplicated webhook ingestion routed by the owning Facebook Page ID.

### Phase 2 — database foundation

- PostgreSQL replaces both global JSON runtime storage and the unused/default-admin SQLite module.
- Versioned transactional migration creates users, workspaces, memberships, sessions, auth tokens, page connections, settings, queue records, history, templates, categories, rules, media metadata, webhook events, rate limits and audit tables.
- Customer-owned records carry a workspace key. Primary/foreign keys enforce page ownership for queued posts. Record payloads use JSONB for compatibility with the existing UI; this is not a fully normalized analytics schema.
- Read/modify/write repository calls are serialized with transaction-scoped advisory locks per workspace, including across application processes.
- Queued jobs bind their destination when created. Atomic claim/update operations replace whole-file queue snapshots, and the broken queue `publish-now` call is replaced.
- Startup config fails closed for missing database/encryption configuration. There is no automatic default admin and no automatic claim of legacy data.

## Requirements

- Node.js 22+ (CI uses Node.js 24), PostgreSQL 16+.
- Persistent storage for `DATA_ROOT`; do not use ephemeral application disk for real customer media.
- SMTP provider or a local SMTP catcher. Verification/reset emails must work before users can log in.
- HTTPS and a correctly configured reverse proxy in production.

## Local/staging setup

1. Install packages with `npm ci`.
2. Copy `.env.example` to `.env` and configure `DATABASE_URL`, `APP_ORIGIN`, `SMTP_URL`, and `MAIL_FROM`.
3. Generate `DATA_ENCRYPTION_KEY` locally:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Put the result in the deployment secret manager or local `.env`, not in Git or chat. Back it up securely. Do not generate a new key on every deployment. Key rotation requires a deliberate decrypt/re-encrypt migration; it is not automatic.

4. Create an empty PostgreSQL database and run `npm run db:migrate`.
5. Run `npm run build:css`, then `npm start`.
6. Visit the application, create an account, open the email verification link, verify, and log in.
7. Connect a page using a verified Page ID/token in the authenticated dashboard. Manual token onboarding remains until the later Meta OAuth phase.
8. Add a Gemini key in authenticated settings. Saved secrets are never returned; leave a secret field blank to retain its value.

Production: use `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, working SMTP, and certificate-validating PostgreSQL TLS (`DATABASE_SSL=require`). Configure `TRUST_PROXY` only with actual trusted proxy IPs/CIDRs. Do not set blanket trust of forwarding headers.

Customer tokens are no longer sourced from the legacy global `FB_PAGE_ACCESS_TOKEN` or `GEMINI_API_KEY` environment variables. This avoids sharing one customer's credentials with new accounts.

## Membership API

Owners can add an **existing, verified** account as editor/viewer with `POST /api/workspace/members` and `{ "email": "member@example.com", "role": "editor" }`. Use the authenticated cookie and CSRF token. `GET /api/workspace/members` lists memberships; `DELETE /api/workspace/members/:userId` removes a non-owner. Changing/removing the owner is deliberately not supported.

- Editors can create content and operate publishing/automation, but cannot manage page credentials, workspace settings, or memberships.
- Viewers can read their workspace only.
- Workspace switching appears in the account control when a user belongs to more than one workspace. Sessions are rotated on switch. Membership removal invalidates the affected workspace sessions.
- A member-management dashboard/invitation email flow is not part of this phase; the API is implemented and tested.

## Legacy migration — explicit, offline and opt-in

Do not point a public deployment at existing global data and let the first signup become its owner.

1. Stop the old application's automation and make a protected backup of its repository, JSON data and uploads.
2. Create/verify the intended owner in the new app. Obtain that owner's workspace UUID from `/api/auth/me`.
3. Review every queued post: the old queue did not store destinations.
4. Import into an empty workspace:

   ```sh
   npm run db:import-legacy -- /absolute/old-repository WORKSPACE_UUID owner@example.com EXPLICIT_LEGACY_PAGE_ID
   ```

   The last argument is mandatory when legacy queue **or history** entries lack a Facebook Page ID. It assigns only those reviewed unattributed entries to the specified destination; explicit existing destinations are validated. Split/review mixed-page data manually before importing.

5. Check imported pages, media, queue destinations and history. Test connections again. Automation remains disabled after import.
6. Keep plaintext legacy backups access-controlled and remove them according to your retention policy only after verifying the new data and backups.

The importer does not overwrite an existing workspace or assign data based on signup order. It does not delete the source. Failed transactions may leave orphaned files under the destination's private media directory; inspect and remove those before retrying an unsuccessful import.

## Background automation/webhooks

Both `ENABLE_AUTOMATION` and `ENABLE_WEBHOOKS` default to false. Enable only after staging tests.

- Configure `FB_APP_SECRET` and `FB_VERIFY_TOKEN` before enabling webhooks. The endpoint is `/api/webhook/facebook`.
- Scheduler cron expressions currently execute in UTC. Set/document the schedule accordingly; a complete user-timezone editor is a later product task.
- Queue jobs with uncertain outcomes become `needs_review`, not automatic retries that could create duplicate posts. Review the actual Facebook page before creating a replacement job.
- Stale `processing` queue jobs older than 15 minutes are flagged for review at scheduler startup. Fresh jobs are not automatically reclaimed during a rolling restart.
- Webhooks are durably accepted and deduplicated, but automatic retry/reconciliation of crashed or partially delivered webhook jobs remains follow-up work. Do not manually reset a job without checking whether the external action already happened.
- This is not an exactly-once guarantee for remote Facebook actions. Start with a single application instance and staging tests; multi-replica operational validation and separate production job-worker deployment are later work.
- Optional external AI fallback is off by default. If enabled, explain the additional provider/data flow to customers. Image search/generation still uses external public image providers; review licensing, privacy, and suitability before public launch.

## Tests

Use a dedicated PostgreSQL database whose name ends in `_test`:

```sh
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/autopost_test npm test
npm run check
npm run build:css
npm audit --omit=dev
```

The suite uses synthetic accounts/data, a test email sink, and blocked/mocked external APIs. It covers account/session flows, CSRF/origin validation, role/tenant isolation, encrypted/redacted credentials, owned/re-encoded uploads, SSRF/path rejection, queue binding/atomic claims, signed/deduplicated webhooks, scoped SSE, rate limits, membership switching, password-reset revocation, logout, and dashboard script startup. jsdom is used for DOM/JavaScript checks, not full browser rendering; its unsupported CSS parser warnings are excluded.

## Required before live rollout

- Review the PR and confirm CI is green.
- Configure database, durable media storage, encryption key, SMTP and HTTPS.
- Test real email delivery, real Meta/Gemini credentials, permissions and App Review requirements in staging.
- Test backups **and restoration**, including the encryption key and media files.
- Add operational monitoring, delivery reconciliation, key rotation procedures, user export/deletion, billing/quotas, support and privacy/legal workflows as subsequent phases.
- Do not describe this phase as a completed or independently security-audited SaaS.

## Phase 2 follow-up

See [Database/backend checklist](BACKEND_PHASE2.md) for relational page constraints, immutable ownership, migration checksums, verified database environment settings and cross-process SSE. Live migration still requires operator configuration and staging review.
