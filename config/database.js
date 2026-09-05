'use strict';

require('dotenv').config();

const STORAGE_MODE = process.env.STORAGE_MODE || 'legacy';
const DATABASE_URL = process.env.DATABASE_URL || '';
const DATABASE_SSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';
const DATABASE_POOL_MIN = parseInt(process.env.DATABASE_POOL_MIN, 10) || 2;
const DATABASE_POOL_MAX = parseInt(process.env.DATABASE_POOL_MAX, 10) || 10;
const DATABASE_STATEMENT_TIMEOUT_MS = parseInt(process.env.DATABASE_STATEMENT_TIMEOUT_MS, 10) || 10000;

const { redactDatabaseUrl } = require('../db/safety-guard');

function validateDatabaseConfig() {
  if (STORAGE_MODE === 'postgres') {
    if (!DATABASE_URL) {
      throw new Error('Configuration Error: DATABASE_URL is required when STORAGE_MODE=postgres. Production and PostgreSQL mode cannot start without a valid database connection string.');
    }
    try {
      const parsed = new URL(DATABASE_URL);
      if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
        throw new Error(`Invalid protocol: "${parsed.protocol}". Expected "postgres:" or "postgresql:".`);
      }
    } catch (err) {
      const redacted = redactDatabaseUrl(DATABASE_URL);
      throw new Error(`Configuration Error: Malformed DATABASE_URL (${redacted}).`);
    }
  }
}

function getDatabaseConfig() {
  validateDatabaseConfig();

  let ssl = false;
  if (DATABASE_SSL) {
    ssl = { rejectUnauthorized: process.env.NODE_ENV === 'production' };
  }

  return {
    storageMode: STORAGE_MODE,
    connectionString: DATABASE_URL,
    ssl,
    min: DATABASE_POOL_MIN,
    max: DATABASE_POOL_MAX,
    statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
  };
}

module.exports = {
  STORAGE_MODE,
  DATABASE_SSL,
  DATABASE_POOL_MIN,
  DATABASE_POOL_MAX,
  DATABASE_STATEMENT_TIMEOUT_MS,
  getDatabaseConfig,
  validateDatabaseConfig
};
