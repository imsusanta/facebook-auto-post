# Isolated SaaS development

Do not use real data or a shared development/production database. Current SaaS
routes are development/test-only and blocked in production.

## Disposable PostgreSQL

```bash
docker compose -f docker-compose.test.yml up -d
export NODE_ENV=test
export ALLOW_TEST_DATABASE=true
export DATABASE_URL='postgres://app_test:test_password_only@127.0.0.1:5432/facebook_auto_poster_test'
npm ci
npm run test:safety-guard
npm run test:postgres
```

The Docker initializer creates a dedicated non-superuser role with no database,
role-creation, replication or RLS-bypass privileges. Its password is a disposable
fixture, not a real secret. PostgreSQL tests reject remote hosts, URL option
redirects, non-test database names, implicit OS users and privileged roles.
Schemas are randomized and removed explicitly; cleanup failure fails the run.

## Exact-commit verification

From an actual clean checkout (not a dependency-symlink shortcut):

```bash
export EXPECTED_HEAD='<exact 40-character commit SHA to verify>'
npm run verify:clean
bash scripts/verify-clean-worktree.sh --test-failure-mode
```

The runner calls `npm ci`, lint, tracked-JS syntax, encoding, safety-guard, legacy,
PostgreSQL and browser tests, then checks HEAD/worktree and cleanup. Each command
has a timeout (`VALIDATION_TIMEOUT_SECONDS`, default 180). It does not silently
opt in to a database. Do not use an arbitrary developer OS account as the DB user.

The browser suite requires local Chrome/Chromium, or a provided shared-browser
CDP connection through `AGENT_BROWSER_CDP`. Shared-browser mode relays real local
HTTP responses using Playwright and closes only its own page, never the browser.
Browser tests cover the legacy UI, not SaaS signup/onboarding or external providers.

```bash
docker compose -f docker-compose.test.yml down
```

## Development identity

With `STORAGE_MODE=postgres`, `/api/auth/login` reads the PostgreSQL user table
and uses PostgreSQL-backed sessions. The user must be active, not deleted and
email-verified. Tests seed synthetic accounts; there is not yet a public signup
or verification-delivery flow. Never mark a real user's email verified merely
to bypass the missing onboarding step.

See [security/identity status](security-identity-pass.md) and
[remaining product delivery gates](delivery-plan.md).
