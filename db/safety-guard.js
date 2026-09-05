'use strict';
const ALLOWED_LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Do not retain userinfo, path, fragment, or query; any may contain credentials.
function redactDatabaseUrl(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) return '[EMPTY_URL]';
  try { new URL(connectionString); return '[DATABASE_URL_REDACTED]'; }
  catch { return '[MALFORMED_URL]'; }
}
function validateLoopbackDatabaseUrl(connectionString) {
  const reject = error => ({ valid: false, error, redactedUrl: redactDatabaseUrl(connectionString) });
  if (typeof connectionString !== 'string' || !connectionString.trim()) return reject('DATABASE_URL is required.');
  let parsed;
  try { parsed = new URL(connectionString); } catch { return reject('Malformed database connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return reject('Invalid protocol.');
  if (!ALLOWED_LOOPBACK_HOSTNAMES.has(parsed.hostname)) return reject('Non-loopback host is prohibited.');
  // libpq URL options can override the actual host/user/database. Disallow all.
  if (parsed.search || parsed.hash) return reject('URL query parameters and fragments are prohibited.');
  if (!/^\/(?:test_[a-z0-9_]+|[a-z0-9_]+_test)$/.test(parsed.pathname) || /prod|production/.test(parsed.pathname)) return reject('A dedicated test database name is required.');
  if (!parsed.username || ['postgres', 'root'].includes(parsed.username)) return reject('An explicit least-privileged test role is required.');
  return { valid: true, hostname: parsed.hostname, redactedUrl: redactDatabaseUrl(connectionString) };
}
function assertSafeTestDatabaseUrl(connectionString, env = process.env) {
  if (env.ALLOW_TEST_DATABASE !== 'true') throw new Error('[Security Error] Explicit ALLOW_TEST_DATABASE=true is required.');
  if (env.NODE_ENV !== 'test') throw new Error('[Security Error] NODE_ENV=test is required.');
  const result = validateLoopbackDatabaseUrl(connectionString);
  if (!result.valid) throw new Error(`[Security Error] ${result.error}`);
  return connectionString;
}
function resolveTestDatabaseUrl() { return assertSafeTestDatabaseUrl(process.env.DATABASE_URL); }
async function assertLeastPrivilegedTestRole(client) {
  const { rows } = await client.query(`SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS inherits_roles,
    current_database() AS database_name
    FROM pg_roles r WHERE r.rolname = current_user`);
  const role = rows[0];
  if (!role || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls || role.inherits_roles || !/^(test_[a-z0-9_]+|[a-z0-9_]+_test)$/.test(role.database_name)) {
    throw new Error('[Security Error] Test database requires a dedicated non-privileged role without inherited roles.');
  }
}
module.exports = { ALLOWED_LOOPBACK_HOSTNAMES, redactDatabaseUrl, validateLoopbackDatabaseUrl, assertSafeTestDatabaseUrl, resolveTestDatabaseUrl, assertLeastPrivilegedTestRole };
