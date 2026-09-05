# Local Development Guide: PostgreSQL Multi-Tenancy

## Prerequisites

- Node.js >= 18 (LTS or higher)
- PostgreSQL 16 (native via Homebrew/apt or via Docker Compose)

---

## Setting Up PostgreSQL 16

### Option A: Using Docker Compose (Recommended)
A lightweight test container configuration is provided in `docker-compose.test.yml`, bound exclusively to `127.0.0.1:5432`:

```bash
# Start PostgreSQL 16 container
docker compose -f docker-compose.test.yml up -d

# Check container status
docker compose -f docker-compose.test.yml ps

# Stop container when done
docker compose -f docker-compose.test.yml down
```

### Option B: Using Native Homebrew (macOS)
```bash
brew install postgresql@16
brew services start postgresql@16
createdb facebook_auto_poster_test
```

---

## Environment Configuration

Create or update your `.env` file for PostgreSQL local development:

```ini
# Storage Mode: legacy (default single-tenant JSON) or postgres (multi-tenant PostgreSQL)
STORAGE_MODE=postgres

# PostgreSQL Connection String
DATABASE_URL=postgres://susantalohar@127.0.0.1:5432/facebook_auto_poster_test

# SSL Configuration (false for local development)
DATABASE_SSL=false

# Pool Sizing & Timeouts
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_STATEMENT_TIMEOUT_MS=10000
```

---

## Running Database Migrations

Apply pending migrations to the configured database:
```bash
npm run db:migrate
```

Verify migration status:
```bash
npm run db:migrate:status
```

Roll back the most recent migration:
```bash
npm run db:rollback
# In production environment:
node scripts/migrate.js down --confirm
```

---

## Verification & Test Suites

Run all validation suites before creating pull requests:

```bash
# 1. Encoding check (UTF-8 without BOM, no CRLF)
npm run check:encoding

# 2. ESLint code style and quality check
npm run lint

# 3. Existing unit & security regression test suite (49 assertions)
npm test

# 4. PostgreSQL cross-tenant isolation suite (42 assertions)
npm run test:postgres

# 5. Headless Chrome browser integration suite (19 assertions)
node tests/browser-test.js
```
