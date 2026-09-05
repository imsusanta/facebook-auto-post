'use strict';

const ALLOWED_LOOPBACK_HOSTNAMES = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]'
]);

const PROD_KEYWORD_REGEX = /aws|rds|neon|supabase|heroku|prod|production/i;

/**
 * Redacts credentials from a database connection string for safe error reporting and logging.
 * Replaces password with '***' while preserving protocol, hostname, port, and database name.
 * Returns '[MALFORMED_URL]' if string cannot be parsed.
 *
 * @param {string} connectionString
 * @returns {string}
 */
function redactDatabaseUrl(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    return '[EMPTY_URL]';
  }

  try {
    const parsed = new URL(connectionString.trim());
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '[MALFORMED_URL]';
  }
}

/**
 * Validates whether a database connection string strictly targets a local loopback interface.
 * Uses WHATWG URL parsing to prevent userinfo spoofing (e.g., postgres://localhost@evil.com/db).
 *
 * @param {string} connectionString
 * @returns {{ valid: boolean, error?: string, hostname?: string, redactedUrl: string }}
 */
function validateLoopbackDatabaseUrl(connectionString) {
  const redacted = redactDatabaseUrl(connectionString);

  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    return {
      valid: false,
      error: 'DATABASE_URL connection string is missing or empty.',
      redactedUrl: redacted
    };
  }

  let parsed;
  try {
    parsed = new URL(connectionString.trim());
  } catch (err) {
    return {
      valid: false,
      error: `Malformed database connection URL: ${err.message}`,
      redactedUrl: redacted
    };
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return {
      valid: false,
      error: `Invalid protocol "${parsed.protocol}". Expected "postgres:" or "postgresql:".`,
      redactedUrl: redacted
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_LOOPBACK_HOSTNAMES.has(hostname)) {
    return {
      valid: false,
      error: `Non-loopback host "${hostname}" is prohibited in test mode. Allowed hosts: ${[...ALLOWED_LOOPBACK_HOSTNAMES].join(', ')}.`,
      hostname,
      redactedUrl: redacted
    };
  }

  // Deceptive production-like database name or query guard
  if (PROD_KEYWORD_REGEX.test(parsed.pathname) || PROD_KEYWORD_REGEX.test(parsed.search)) {
    return {
      valid: false,
      error: 'Database name or query parameters contain production keywords (prod/production/aws/rds/neon/supabase/heroku).',
      hostname,
      redactedUrl: redacted
    };
  }

  return {
    valid: true,
    hostname,
    redactedUrl: redacted
  };
}

/**
 * Asserts that a database connection string is safe for test execution.
 * Throws a sanitized Error with credentials redacted if validation fails.
 *
 * @param {string} connectionString
 * @returns {string} The validated connection string
 */
function assertSafeTestDatabaseUrl(connectionString) {
  const result = validateLoopbackDatabaseUrl(connectionString);
  if (!result.valid) {
    throw new Error(`[Security Error] Test runner safety guard rejected DATABASE_URL: ${result.error} (${result.redactedUrl})`);
  }
  return connectionString;
}

/**
 * Resolves the canonical test database URL from environment or default loopback target.
 *
 * @returns {string}
 */
function resolveTestDatabaseUrl() {
  const raw = process.env.DATABASE_URL || 'postgres://127.0.0.1:5432/facebook_auto_poster_test';
  return assertSafeTestDatabaseUrl(raw);
}

module.exports = {
  ALLOWED_LOOPBACK_HOSTNAMES,
  redactDatabaseUrl,
  validateLoopbackDatabaseUrl,
  assertSafeTestDatabaseUrl,
  resolveTestDatabaseUrl
};
