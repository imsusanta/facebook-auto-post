# PostgreSQL identity lifecycle (gated backend slice)

## Status and boundaries

**CORRECTIONS INCOMPLETE — not a complete SaaS or production release.**
This branch extends Draft PR #5 with an account-lifecycle backend and verification
workflow. Production PostgreSQL auth/workspace routes remain blocked. Nothing in
this document authorizes a merge, deployment, real-data migration, paid service
or production credential use.

There is no public signup/recovery UI or real email provider in this slice.
Verification/reset links in test mail point to future `/account/verify` and
`/account/reset` screens. HTTP tests extract their fragment tokens and submit
those tokens to the real backend endpoints; that is **not** a browser UI proof.

## Implemented routes (PostgreSQL mode only)

| Route | Authentication and behavior |
| --- | --- |
| POST /api/auth/signup | Bounded email/password input; unverified pending account; generic 202; caller role/status/verification fields ignored |
| POST /api/auth/resend-verification | Generic 202 for eligible/ineligible/unknown accounts; fresh link invalidates earlier verification links |
| POST /api/auth/verify-email | Single-use, purpose-bound, unexpired hashed token; conditional transition activates eligible unverified account |
| POST /api/auth/forgot-password | Generic 202; only active verified accounts receive captured test mail; fresh reset link invalidates older reset links |
| POST /api/auth/reset-password | Single-use reset token; replaces password and atomically revokes all sessions/action tokens; fresh login required |
| POST /api/auth/change-password | Current session, valid CSRF and current password; atomically changes password/revokes all sessions; fresh login required |
| POST /api/auth/logout-all | Current session and CSRF; invalidates all sessions and outstanding action tokens |
| POST /api/auth/login | Async bounded password verification; transactional recheck and optional legacy-hash upgrade before cookie issuance |
| GET /api/auth/session | Persistent cookie lookup with current account status, verification, expiration and auth-version checks |
| POST /api/auth/logout | Existing session + CSRF; removes that session |

Credential/action JSON requests have origin checks; authenticated mutations also
have CSRF. Responses use no-store, server-owned request IDs, fixed public error
messages and safe diagnostic classifications, not raw internal error strings.
Generic signup/recovery responses reduce account enumeration through status/body
content; no constant-time or all-side-channel-resistance claim is made.

## Passwords and revocation

- New passwords use asynchronous Argon2id: memory 19,456 KiB, time cost 2,
  parallelism 1, 32-byte output, fresh random salt.
- New passwords require at least 12 Unicode code points and at most 1,024 UTF-8
  bytes. Passwords are not trimmed or normalized.
- Existing bounded PBKDF2 SHA-512/100,000 hashes remain verifiable. Successful
  credential verification can rehash even a legacy password below today's
  signup minimum, preserving its exact value. Hash/algorithm metadata change in
  the session transaction only if the expected old hash AND auth version match.
- Stored Argon2 parameters are parsed independently of parameter ordering, checked
  for duplicates, and bounded before library verification. Malformed hashes fail
  closed; no unbounded hash parameters are trusted from storage.
- Each process admits at most four simultaneous password operations, with no
  unbounded pending work queue. Saturation returns a generic retryable failure.
- `users.auth_version` and matching session/action-token versions serialize
  credential changes and session issuance under an account row lock. Logout-all
  protects against a pending login even when the password hash is unchanged.
- Suspension/deletion through the internal user repository revokes sessions and
  action tokens. There is no new public administrative suspension/lift API.
  Administrative authorization and UI remain deferred.
- Revocation prevents subsequent session validation/issuance. It is not a claim
  that an already-authorized, in-flight unrelated request is retroactively undone.

A local five-hash synthetic benchmark averaged approximately 31 ms per hash on
this sandbox. This is not production capacity/SLO evidence; production hardware,
concurrency, throughput and abuse resistance still need measurement.

## Action tokens, mail and retry policy

Verification TTL is 24 hours; reset TTL is 30 minutes. Validation tables store
SHA-256 digests, purposes, versions and single-use timestamps, not raw tokens.
Account/token changes and associated security events commit transactionally.
Resend invalidates old links, and queued obsolete mail is cancelled and scrubbed.

Mail delivery uses a durable PostgreSQL outbox. Payloads containing recipient and
action links are AES-256-GCM encrypted with random nonces and the outbox ID bound
as authenticated data. Delivered/cancelled payloads are cleared. Links are built
from trusted configuration, not request Host or forwarded headers; tokens use URL
fragments, not query parameters.

**Only a test-capture adapter exists.** It requires all of:

- NODE_ENV=test
- ALLOW_TEST_MAIL=true
- AUTH_MAIL_ADAPTER=test
- AUTH_MAIL_ENCRYPTION_KEY: an explicit 32-byte hexadecimal test key
- AUTH_PUBLIC_ORIGIN: an explicit loopback test origin

No fallback provider is selected. Without mail configuration, delivery-dependent
routes fail closed with a generic 503. The test adapter cannot activate in
production and cannot be read through an HTTP endpoint. Its captured-message and
idempotency collections are bounded and test-only.

Requests attempt delivery after the account transaction commits. Failed delivery
retains the encrypted message for retry; backoff grows to 64 minutes with a maximum
of eight attempts, then cancels/scrubs the message. Tests explicitly drain pending
mail through the service API. There is no deployed background mail worker here.
The implemented adapter does not perform network IO while holding locks. A future
real provider needs a reviewed claim/lease design outside DB transactions,
provider-side idempotency/reconciliation, key rotation, retention and delivery
monitoring; it must not simply be swapped into the locked test-capture path.
Test idempotency is in-memory and only proves the tested process lifetime, not
cross-process external-email exactly-once delivery.

Production email provider, verified sending domain and secure credentials remain
**BLOCKED pending owner selection/configuration**. No external email was sent in
these tests. Durable delivery infrastructure and real-provider integration are
not claimed complete.

## Shared rate limits and audit

A shared PostgreSQL bucket store uses keyed hashes of operation + server-resolved
client IP, not raw addresses or arbitrary email/account lockouts. The configured
AUTH_RATE_LIMIT_KEY must be a stable 32-byte hexadecimal secret shared by instances.
Tests generate synthetic keys. Limits are per 15-minute window:

- login: 20; signup/resend/recovery: 5 each;
- action token submissions: 30; session reads: 120; password change/logout-all: 10.

Expired buckets are pruned during admission. A transactional table lock caps the
store at 10,000 live keys and prevents concurrent cap bypass. It fails closed when
storage/configuration is unavailable or full. This simple shared implementation
is not a high-throughput claim; the global lock, trusted-proxy configuration and
capacity policy need load/abuse review before production.

Account security events use a separate account-level table, no invented workspace
IDs and no arbitrary metadata containing secrets. Events record the subject,
allowlisted action, version, safe server request ID and time. No user-facing
administrator audit browser/retention policy is added. Tests inject audit failures
and verify signup/verification/password/revocation/status mutations roll back.

## Migration and dependency changes

Migration 009 adds version columns, action tokens, encrypted outbox, account
security events and rate buckets. Published migrations 001–008 are unchanged.
Rollback intentionally removes every session before removing version columns,
preventing old software from resurrecting revoked cookies. Rollback also removes
new lifecycle tables; it is destructive and only tested on disposable schemas.
Production rollback needs a separately reviewed/approved recovery plan.

The qs transitive dependency is overridden to compatible 6.16.x to address the
query-parser advisories while retaining Express 4. Existing regressions run with
that version. A fresh audit reports two moderate findings in node-cron/uuid.
The inspected scheduler uses uuid.v4() without caller-supplied output buffers;
the advisory concerns buffer handling in v3/v5/v6. No scheduler major upgrade or
unreviewed transitive major override was forced. These findings remain explicitly
tracked for independent review/remediation before launch, not silently waived.
The automated audit gate fails high/critical findings; green CI does not mean
there are zero lower-severity advisories.

## Evidence requirements

The PostgreSQL suite retains the 72 earlier cases and adds actual HTTP lifecycle
cases covering registration/verification, reset/change/logout-all, concurrent token
consumption, pending-login revocation, malformed hashes, hashing concurrency,
expired/obsolete action links, mail retries/commit failure, rate-store capacity,
audit rollback, production gating, and migration rollback/reapplication.

Only tests specifically named legacy-hash migration or trusted repository behavior
seed verified users. The signup/verification/recovery tests obtain tokens from
captured test mail and use actual HTTP routes, not createSession() or
markEmailVerified() shortcuts. The 19-case browser suite remains legacy UI coverage.

The verification runner adds a high/critical dependency audit gate and still
requires exact committed HEAD, clean npm ci, no dependency shortcuts, timeouts,
all existing suites and failure-preserving cleanup. The GitHub Actions workflow
uses normal pull_request events, read-only permissions, pinned verified action
revisions, synthetic database credentials and no production secrets/deployments.
It must actually run on the published PR before CI can be called passing.

## Still deferred

- Human security review and actual hosted CI results until the PR runs.
- Production mail provider/domain, delivery worker, external idempotency, key
  rotation, token/event retention and operational monitoring.
- Full authentication/customer UI, admin suspension/lift flows and session/device UI.
- Tenant posts/pages/media/settings; Meta OAuth and approval; durable publishing;
  billing/entitlements; backups, privacy/compliance, load/restore tests and launch.

See delivery-plan.md for the remaining product gates.
