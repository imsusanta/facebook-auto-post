require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const production = process.env.NODE_ENV === 'production';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:3000';
function integer(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} is outside the supported range`);
  return value;
}
function flag(name) {
  const value = process.env[name] || 'false';
  if (!['true', 'false'].includes(value))
    throw new Error(`${name} must be true or false`);
  return value === 'true';
}
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_SSL = process.env.DATABASE_SSL || 'disable';
const database = {
  connectionString: DATABASE_URL,
  max: integer('DB_POOL_MAX', 10, 2, 100),
  connectionTimeoutMillis: integer('DB_CONNECT_TIMEOUT_MS', 5000, 100, 60000),
  idleTimeoutMillis: integer('DB_IDLE_TIMEOUT_MS', 30000, 1000, 300000),
  statement_timeout: integer('DB_STATEMENT_TIMEOUT_MS', 30000, 1000, 300000),
  application_name: 'autopost',
  ssl:
    DATABASE_SSL === 'require'
      ? {
          rejectUnauthorized: true,
          ...(process.env.DATABASE_CA_FILE
            ? { ca: fs.readFileSync(process.env.DATABASE_CA_FILE, 'utf8') }
            : {})
        }
      : false
};
function validateDatabase() {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
  const url = new URL(DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname === '/'
  )
    throw new Error('DATABASE_URL must identify a PostgreSQL database');
  if (!['disable', 'require'].includes(DATABASE_SSL))
    throw new Error('DATABASE_SSL must be disable or require');
  // pg connection-string SSL parameters can override certificate verification. Keep TLS policy centralized.
  for (const key of url.searchParams.keys())
    if (key.toLowerCase().startsWith('ssl'))
      throw new Error(
        'Configure database TLS using DATABASE_SSL/DATABASE_CA_FILE, not URL SSL parameters'
      );
  if (production && DATABASE_SSL !== 'require')
    throw new Error('Production requires verified database TLS');
}
function validate() {
  validateDatabase();
  const url = new URL(APP_ORIGIN);
  if (
    url.origin !== APP_ORIGIN ||
    !['http:', 'https:'].includes(url.protocol) ||
    (production && url.protocol !== 'https:')
  )
    throw new Error('APP_ORIGIN must be an exact origin (HTTPS in production)');
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.DATA_ENCRYPTION_KEY || ''))
    throw new Error(
      'DATA_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters'
    );
  if (production && (!process.env.SMTP_URL || !process.env.MAIL_FROM))
    throw new Error('SMTP_URL and MAIL_FROM are required in production');
  if (
    flag('ENABLE_WEBHOOKS') &&
    (!process.env.FB_APP_SECRET || !process.env.FB_VERIFY_TOKEN)
  )
    throw new Error('Webhooks require FB_APP_SECRET and FB_VERIFY_TOKEN');
  integer('MAX_WORKSPACE_MEDIA_BYTES', 268435456, 1, 1099511627776);
}
module.exports = {
  PORT: integer('PORT', 3000, 1, 65535),
  NODE_ENV: process.env.NODE_ENV || 'development',
  production,
  APP_ORIGIN,
  validate,
  validateDatabase,
  database,
  DATA_ROOT: path.resolve(
    process.env.DATA_ROOT || path.join(__dirname, '..', 'data')
  ),
  ENABLE_AUTOMATION: flag('ENABLE_AUTOMATION'),
  ENABLE_WEBHOOKS: flag('ENABLE_WEBHOOKS')
};
