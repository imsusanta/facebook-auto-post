'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPool } = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations', 'postgres');
const ADVISORY_LOCK_KEY_1 = 8392104;
const ADVISORY_LOCK_KEY_2 = 9281729;

function calculateChecksum(content) {
  return crypto.createHash('sha256').update(content.trim(), 'utf8').digest('hex');
}

/**
 * Ensures schema_migrations tracking table exists.
 * @param {import('pg').PoolClient} client
 */
async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Loads and sorts migration files from the migrations directory.
 * Filters out down/rollback files.
 * @returns {Array<{version: string, name: string, filename: string, filepath: string, downFilepath: string|null, checksum: string, sql: string}>}
 */
function loadMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    return [];
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && !f.endsWith('_down.sql'))
    .sort();

  return files.map(filename => {
    const filepath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(filepath, 'utf8');
    const checksum = calculateChecksum(sql);

    // Parse version prefix, e.g. "001" from "001_extensions.sql"
    const match = filename.match(/^([0-9]+)_(.+)\.sql$/);
    const version = match ? match[1] : filename.replace('.sql', '');
    const name = match ? match[2] : filename.replace('.sql', '');

    const downFilename = filename.replace(/\.sql$/, '_down.sql');
    const downFilepath = path.join(MIGRATIONS_DIR, downFilename);

    return {
      version,
      name,
      filename,
      filepath,
      downFilepath: fs.existsSync(downFilepath) ? downFilepath : null,
      checksum,
      sql
    };
  });
}

/**
 * Runs pending PostgreSQL migrations with advisory locking and checksum validation.
 * @param {object} [options]
 * @param {object} [options.poolOverride]
 * @returns {Promise<Array<{version: string, name: string, status: string}>>}
 */
async function runMigrations(options = {}) {
  const pool = options.poolOverride || getPool();
  const client = await pool.connect();
  const results = [];

  try {
    // Acquire PostgreSQL session advisory lock to prevent concurrent migration runners
    await client.query('SELECT pg_advisory_lock($1, $2)', [ADVISORY_LOCK_KEY_1, ADVISORY_LOCK_KEY_2]);

    await ensureMigrationsTable(client);

    // Fetch applied migrations
    const { rows: appliedRows } = await client.query(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
    );
    const appliedMap = new Map(appliedRows.map(r => [r.version, r]));

    const migrationFiles = loadMigrationFiles();

    // 1. Verify integrity of already applied migrations
    for (const file of migrationFiles) {
      if (appliedMap.has(file.version)) {
        const applied = appliedMap.get(file.version);
        if (applied.checksum !== file.checksum) {
          throw new Error(
            `Migration Integrity Violation: Checksum mismatch for migration "${file.filename}". ` +
            `Applied checksum: ${applied.checksum}, Current file checksum: ${file.checksum}. ` +
            `Migrations must be immutable once applied.`
          );
        }
      }
    }

    // 2. Apply pending migrations sequentially inside transactions
    for (const file of migrationFiles) {
      if (!appliedMap.has(file.version)) {
        await client.query('BEGIN');
        try {
          await client.query(file.sql);
          await client.query(
            'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
            [file.version, file.name, file.checksum]
          );
          await client.query('COMMIT');
          results.push({ version: file.version, name: file.name, status: 'applied' });
        } catch (migrationErr) {
          await client.query('ROLLBACK');
          throw new Error(`Failed applying migration ${file.filename}: ${migrationErr.message}`);
        }
      } else {
        results.push({ version: file.version, name: file.name, status: 'already_applied' });
      }
    }

    return results;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_KEY_1, ADVISORY_LOCK_KEY_2]);
    } catch (unlockErr) {
      console.error('[Migrator] Error unlocking advisory lock:', unlockErr.message);
    }
    client.release();
  }
}

/**
 * Returns migration status for all known migration files.
 * @param {object} [options]
 * @returns {Promise<Array<{version: string, name: string, status: string, appliedAt: Date|null}>>}
 */
async function getMigrationStatus(options = {}) {
  const pool = options.poolOverride || getPool();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const { rows: appliedRows } = await client.query(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
    );
    const appliedMap = new Map(appliedRows.map(r => [r.version, r]));

    const migrationFiles = loadMigrationFiles();
    return migrationFiles.map(file => {
      const applied = appliedMap.get(file.version);
      return {
        version: file.version,
        name: file.name,
        filename: file.filename,
        status: applied ? 'applied' : 'pending',
        appliedAt: applied ? applied.applied_at : null,
        checksum: file.checksum
      };
    });
  } finally {
    client.release();
  }
}

/**
 * Rolls back the latest applied migration.
 * @param {object} [options]
 * @returns {Promise<{version: string, name: string, status: string}>}
 */
async function rollbackLatestMigration(options = {}) {
  const pool = options.poolOverride || getPool();
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [ADVISORY_LOCK_KEY_1, ADVISORY_LOCK_KEY_2]);
    await ensureMigrationsTable(client);

    const { rows } = await client.query(
      'SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1'
    );

    if (rows.length === 0) {
      return { status: 'no_migrations_to_rollback' };
    }

    const latest = rows[0];
    const migrationFiles = loadMigrationFiles();
    const file = migrationFiles.find(f => f.version === latest.version);

    if (!file || !file.downFilepath) {
      throw new Error(`Cannot rollback migration ${latest.version}_${latest.name}: No matching down file found.`);
    }

    const downSql = fs.readFileSync(file.downFilepath, 'utf8');

    await client.query('BEGIN');
    try {
      await client.query(downSql);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [latest.version]);
      await client.query('COMMIT');
      return { version: latest.version, name: latest.name, status: 'rolled_back' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Rollback failed for ${file.filename}: ${err.message}`);
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_KEY_1, ADVISORY_LOCK_KEY_2]);
    } catch (unlockErr) {
      console.error('[Migrator] Error unlocking advisory lock on rollback:', unlockErr.message);
    }
    client.release();
  }
}

module.exports = {
  runMigrations,
  getMigrationStatus,
  rollbackLatestMigration,
  calculateChecksum
};
