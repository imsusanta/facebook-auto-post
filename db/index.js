'use strict';

const { Pool } = require('pg');
const { getDatabaseConfig } = require('../config/database');

let pool = null;

/**
 * Initializes or returns the PostgreSQL connection pool.
 * @param {object} [overrideConfig] Optional config override for testing
 * @returns {Pool}
 */
function getPool(overrideConfig = null) {
  if (!pool) {
    const config = overrideConfig || getDatabaseConfig();
    pool = new Pool({
      connectionString: config.connectionString,
      ssl: config.ssl,
      min: config.min,
      max: config.max,
      statement_timeout: config.statement_timeout,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      idleTimeoutMillis: config.idleTimeoutMillis
    });

    pool.on('error', (err) => {
      // Log sanitized notification without exposing connection strings
      console.error('[PostgreSQL] Unexpected client error on idle connection:', err.message);
    });
  }
  return pool;
}

/**
 * Executes a parameterized query using the pool.
 * Never use string concatenation for SQL queries.
 * @param {string} text SQL statement with $1, $2 parameter placeholders
 * @param {Array} [params] Parameter array
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params = []) {
  const p = getPool();
  return p.query(text, params);
}

/**
 * Executes an atomic database operation inside a PostgreSQL transaction.
 * Automatically handles BEGIN, COMMIT, ROLLBACK, and client release.
 * @template T
 * @param {function(import('pg').PoolClient): Promise<T>} callback
 * @returns {Promise<T>}
 */
async function withTransaction(callback) {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[PostgreSQL] Error during transaction rollback:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully shuts down the connection pool.
 * @returns {Promise<void>}
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Resets the active pool instance (primarily for tests).
 */
function resetPool() {
  pool = null;
}

module.exports = {
  getPool,
  query,
  withTransaction,
  closePool,
  resetPool
};
