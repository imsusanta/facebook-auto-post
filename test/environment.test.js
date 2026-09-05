const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
function check(overrides = {}, code = "require('./config/env').validate()") {
  return spawnSync(process.execPath, ['-e', code], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://app.example.test',
      DATABASE_URL: 'postgresql://test:test@localhost/autopost_test',
      DATABASE_SSL: 'require',
      DATA_ENCRYPTION_KEY: 'a'.repeat(64),
      SMTP_URL: 'smtp://127.0.0.1:1025',
      MAIL_FROM: 'test@example.test',
      ENABLE_WEBHOOKS: 'false',
      ENABLE_AUTOMATION: 'false',
      DATABASE_CA_FILE: '',
      ...overrides
    },
    encoding: 'utf8'
  });
}
test('environment validation rejects unsafe or malformed database configuration', () => {
  for (const values of [
    { DATABASE_URL: '' },
    { DATABASE_URL: 'https://example.test/db' },
    { DATABASE_SSL: 'disable' },
    {
      DATABASE_URL:
        'postgresql://test:test@localhost/autopost_test?sslmode=no-verify'
    },
    { DB_POOL_MAX: '0' },
    { PORT: 'NaN' },
    { ENABLE_AUTOMATION: 'yes' }
  ])
    assert.notEqual(check(values).status, 0);
});
test('validated PostgreSQL settings are wired into the pool', () => {
  const result = check(
    {
      DB_POOL_MAX: '4',
      DB_CONNECT_TIMEOUT_MS: '1700',
      DB_STATEMENT_TIMEOUT_MS: '9000'
    },
    "const assert=require('node:assert/strict');require('./config/env').validate();const db=require('./services/db');assert.equal(db.pool.options.max,4);assert.equal(db.pool.options.connectionTimeoutMillis,1700);assert.equal(db.pool.options.statement_timeout,9000);assert.equal(db.pool.options.ssl.rejectUnauthorized,true);db.pool.end();"
  );
  assert.equal(result.status, 0, result.stderr);
});
