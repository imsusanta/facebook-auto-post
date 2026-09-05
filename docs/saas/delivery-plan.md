# Complete SaaS delivery plan and launch gates

## Product completion contract

A complete release must let an ordinary customer register, verify ownership of
an email, securely log in, create/switch workspaces, invite teammates, connect an
authorized Facebook Page, compose/review/schedule/publish content reliably, manage
subscription/limits, export/delete their data and receive operational support.
All domain data must be tenant-isolated. A scaffold, route stub, mocked payment,
or passing injected-identity test is not completion.

Current delivered slice: security corrections and PostgreSQL credential/session
integration. Everything below remains pending unless evidence is linked in its
reviewed implementation PR. Keep PR #4 and follow-on implementation PRs Draft
until their respective gates are reviewed. Never merge/deploy or touch real data
as a side effect of implementation work.

## Ordered delivery gates

| Gate | Deliverable | Required evidence before calling it done |
| --- | --- | --- |
| 0. Security foundation | Finish independent review of this security/identity slice and remaining races/operational concerns | Exact-HEAD clean verification, fault canaries, tenant matrix, audit rollback tests, resolved dependency advisories |
| 1. Identity lifecycle | Signup, verification/resend, recovery, password change, secure hash migration, user suspension/deletion and session revocation | Actual HTTP signup → delivered test verification → login → reset/revoke; generic anti-enumeration responses; single-use expiring hashed tokens; abuse tests |
| 2. Tenant domain | Workspace-scoped Pages, credential references, posts/versions, schedules, media, templates and settings | Implemented in Draft PR (Gate 2). 131/131 postgres+identity tests passing; composite tenant-safe constraints verified; negative cross-tenant tests verified; zero global JSON fallback verified |
| 3. Customer UI | Bengali-first onboarding, workspace switcher, team roles/invites, composer, calendar, history, settings and security screens | Implemented in Draft PR (Gate 3). 17/17 browser E2E customer UI tests passing; Bengali-first onboarding wizard verified; workspace switcher and role badges verified; team member management and invites verified; zero plaintext token exposure verified |
| 4. Meta connection | OAuth state binding, approved Page permissions, explicit Page selection/ownership policy, encrypted server-only tokens, disconnect/deletion callbacks | Implemented in Draft PR (Gate 4). 151/151 postgres+oauth tests passing; AES-256-GCM token vault with row-level AAD verified; single-use OAuth state verified; tenant-routed webhooks and event deduplication verified; no production tokens in tests |
| 5. Durable publishing | Worker processes, transaction/outbox reconciliation, idempotency ledger, retries/backoff, cancellation, dead-letter handling and tenant limits | Worker/DB/queue restart tests; ambiguous provider-response reconciliation; no duplicate-publish claims without fault tests |
| 6. Commercial model | Selected payment provider, plan entitlements, checkout, webhook verification/idempotency, grace/cancellation/refund rules and usage screens | Sandbox purchase/renewal/failure/cancel/refund; entitlement enforcement in API and workers; reconciliation proof |
| 7. Privacy and operations | Private object storage, signed media access, retention/export/delete, observability, secrets management, staging/prod separation and backups | Restore drill, access review, deletion runbook, alert test, incident exercise and agreed SLOs |
| 8. Launch | Required CI, migration/release/rollback procedures, load/security tests, docs and limited pilot | Human approval, reviewed privacy/terms, Meta approval, billing readiness and production smoke tests under separately authorized deployment |

## Decisions needed before the affected gate

1. **Hosting and region:** deployment platform, data residency, staging domain,
   object storage and managed PostgreSQL/queue services.
2. **Email delivery:** provider and verified sending domain. Test adapters may
   capture messages locally, but cannot stand in for verified production delivery.
3. **Billing:** Razorpay/Stripe/another eligible provider, settlement country,
   currency, legal merchant account, plans/limits and refund/tax policy.
4. **Meta app:** app ownership, approved permissions, callback domain, test assets,
   Page ownership-transfer policy and App Review responsibilities.
5. **Operations:** retention periods, backup/restore objectives, support ownership,
   approved security review and production launch authority.

Supply credentials via a secret manager or secure input—not source, issue text,
chat, logs, or committed environment files. Decisions are not guessed on the
customer's behalf. No account, billable service or subscription is provisioned by
this plan.

## Implementation discipline

- Deliver small reviewable branches in dependency order; no giant “SaaS complete” PR.
- Preserve published migration checksums and Git history. Use additive migrations
  with tested rollback/precondition behavior.
- Run only against randomized schemas in an explicitly allowed disposable local
  database. Domain migrations need their own synthetic import/rollback fixtures.
- Keep legacy operator identity/data separate until an approved migration exists.
- Document implemented, tested and deferred capabilities separately.
- External sandbox/production approval gates must remain blockers, never mocked
  into a green readiness claim.

Final product status remains **CORRECTIONS INCOMPLETE** until every launch gate
has real evidence and the owner explicitly approves a production release.
