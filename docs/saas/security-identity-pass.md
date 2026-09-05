# Security and PostgreSQL identity implementation

## Status

**CORRECTIONS INCOMPLETE — the product is not a complete or production-ready SaaS.**
This branch implements a tested security/identity slice on top of Draft PR #4,
not the entire roadmap. Do not merge, deploy, or run migrations on real data
without a separate review and approval. No readiness percentages are used.

## Implemented

- Workspace create/update and invitation create/revoke recheck active actor
  authority within their transactions, rather than trusting middleware alone.
- Membership and invitation operations lock workspace, then invitation rows,
  then membership rows, then user rows. Shared user rows are ordered by UUID.
- Acceptance checks active workspace, accepting user, verified email, member
  state, and the identifiable inviter's current authority. Null/unauthorized
  inviters fail closed. Suspended memberships cannot self-reactivate.
- Expiration is conditional on `pending` and database time, under the workspace
  and invitation locks. Accepted/revoked states are not overwritten. Acceptance
  also checks expiry at its final conditional transition.
- Domain errors are constructed explicitly. HTTP responses publish only static
  allowlisted messages; arbitrary error-message substrings no longer determine
  status or public content. Operational diagnostics use the existing logger,
  retaining fixed operation/request ID/allowlisted error category, never raw
  error text, stack, SQL details, or credentials.
- Request IDs are server-generated. Client IDs are deliberately not reflected.
- Test URL guard requires explicit opt-in, loopback hostname, explicit test role,
  a test-named database, and no URL query/fragment overrides. Role privileges
  are checked before creating the random schema. No userinfo/URL is logged.
- `/api/auth/login` in PostgreSQL mode verifies the actual PostgreSQL credential
  and creates a hashed-token, persistent PostgreSQL session. Sessions survive
  pool recreation, rotate at login, and recheck active/verified identity on use.
  Ordinary SaaS identities always get global role `user`, never operator roles.
- PostgreSQL-mode auth has no fallback to legacy setup, dev-login or admin key.
  Its logout requires session/CSRF, and responses are non-cacheable.
- Legacy `/uploads` now requires operator authentication just like legacy APIs.
  This is **not** a tenant media library or signed-URL implementation.
- SaaS auth and workspace routes are explicitly blocked in production. There is
  intentionally no production-enabling flag in this slice.
- Migration 007 adds persistent sessions; migration 008 adds administrative
  workspace suspension. Existing published migrations are unchanged. Rolling
  back 008 fails if suspended rows exist; it never silently restores access.

## Authentication design decision

PostgreSQL sessions are used instead of adding Redis solely for login. This
removes the in-process-session correctness dependency for the new auth path.
Redis/BullMQ may still be introduced for distributed rate limits and jobs after
those designs are reviewed. Legacy auth/session behavior remains separate.
This is not a claim that all identity work is finished: signup, email delivery,
verification links, recovery, password-hash migration, session-management UI,
account-wide revocation flows, account audit events and distributed abuse
controls remain launch blockers.

## Evidence and honest coverage

`tests/postgres-runner.js` distinguishes:

- Tests 1–50 and active-principal/race tests: injected-identity or repository
  authorization tests, not a login proof.
- Tests 51–53: directly injected session-cookie/CSRF middleware tests, renamed
  so they do not imply credential verification.
- Tests 57–58: actual HTTP login against PostgreSQL, cookie issuance/rotation,
  persistent session read, workspace mutation, missing/invalid CSRF denial,
  cross-tenant denial, inactive/unverified account rejection and logout.
- Test 54: injected header rejection with production/development/unset NODE_ENV.
- New cases: inactive/deleted user/workspace endpoint matrix; HTTP fault injection
  with captured console/logger output and secret canaries; server request IDs;
  repository actor revalidation; deterministic workspace-lock barriers for
  accept/revoke, expiration/revoke and inviter demotion/removal races; rollback
  of seven mutation types when audit insertion fails.

The legacy browser suite exercises the existing dashboard, **not SaaS onboarding**.
When `AGENT_BROWSER_CDP` is supplied it uses one new shared-browser page, relays
real local HTTP responses through Playwright, and closes only that page. This
checks rendering/login/CSRF UI behavior; it is not a streaming SSE, Meta, or
billing integration test. Without that variable the existing local Chrome
launcher remains available for developers/CI.

Run `verify:clean` only with an explicit expected committed HEAD. The runner
installs dependencies with `npm ci`, rejects dependency shortcuts, applies timeouts,
checks lint/syntax/encoding/regression/PostgreSQL/browser suites, and preserves
failure status during cleanup. The schema manifest permits cleanup even if the
PostgreSQL suite is interrupted. Cleanup errors fail the run. Failure-mode proofs
exercise the same command runner and EXIT trap (validation exit 37, cleanup exit 74).

## Still deferred / not proved

- Full concurrent account-administration workflows and suspension-lift API.
- Registration/email verification/recovery and password algorithm migration.
- Session expiry/rotation load testing, distributed throttling and session UI.
- Tenant posts/pages/media/templates/settings and tenant-safe workers.
- Meta OAuth/review, token vault and actual external publishing.
- Billing, entitlements, payments and signed provider webhooks.
- CI enforcement, deployment, backups/restore drills, operational alerts and
  independent security review. Passing local suites does not prove these.
- The dependency audit currently reports moderate advisories. Resolve/revalidate
  the Express/body-parser/qs chain and node-cron/uuid chain before public launch;
  no forced scheduler major-version upgrade was made in this security slice.

See [SaaS delivery plan](delivery-plan.md) for the remaining acceptance gates.
