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
 * Checks if schema_migrations tracking table exists without creating it.
 * @param {import('pg').PoolClient} client
 * @returns {Promise<boolean>}
 */
async function checkMigrationsTableExists(client) {
  const { rows } = await client.query("SELECT to_regclass('schema_migrations') as regclass;");
  return Boolean(rows[0] && rows[0].regclass);
}

/**
 * Loads and sorts migration files from the migrations directory.
 * Enforces filename format, unique versions, and rejects empty files.
 * @param {string} [dir] Custom migrations directory for testing
 * @returns {Array<{version: string, name: string, filename: string, filepath: string, downFilepath: string|null, checksum: string, sql: string}>}
 */
function loadMigrationFiles(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return [];
  }

  const allFiles = fs.readdirSync(dir);
  const upFiles = allFiles
    .filter(f => f.endsWith('.sql') && !f.endsWith('_down.sql'))
    .sort();

  const seenVersions = new Set();

  return upFiles.map(filename => {
    // Enforce strict format: NNN_description.sql
    const match = filename.match(/^([0-9]{3,})_([a-zA-Z0-9_-]+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid migration filename format: "${filename}". Expected format: "NNN_description.sql"`);
    }

    const version = match[1];
    const name = match[2];

    if (seenVersions.has(version)) {
      throw new Error(`Duplicate migration version detected: "${version}" in file "${filename}"`);
    }
    seenVersions.add(version);

    const filepath = path.join(dir, filename);
    const sql = fs.readFileSync(filepath, 'utf8');

    if (!sql.trim()) {
      throw new Error(`Empty migration file rejected: "${filename}"`);
    }

    const checksum = calculateChecksum(sql);

    const downFilename = `${version}_${name}_down.sql`;
    const downFilepath = path.join(dir, downFilename);
    let validDownFilepath = null;

    if (fs.existsSync(downFilepath)) {
      const downSql = fs.readFileSync(downFilepath, 'utf8');
      if (!downSql.trim()) {
        throw new Error(`Empty down migration file rejected: "${downFilename}"`);
      }
      validDownFilepath = downFilepath;
    }

    return {
      version,
      name,
      filename,
      filepath,
      downFilepath: validDownFilepath,
      checksum,
      sql
    };
  });
}

/**
 * Runs pending PostgreSQL migrations with advisory locking and checksum validation.
 * @param {object} [options]
 * @param {object} [options.poolOverride]
 * @param {string} [options.migrationsDir]
 * @returns {Promise<Array<{version: string, name: string, status: string}>>}
 */
async function runMigrations(options = {}) {
  const pool = options.poolOverride || getPool();
  const client = await pool.connect();
  const results = [];

  try {
    // Acquire session advisory lock
    await client.query('SELECT pg_advisory_lock($1, $2)', [ADVISORY_LOCK_KEY_1, ADVISORY_LOCK_KEY_2]);

    await ensureMigrationsTable(client);

    const { rows: appliedRows } = await client.query(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
    );
    const appliedMap = new Map(appliedRows.map(r => [r.version, r]));

    const migrationFiles = loadMigrationFiles(options.migrationsDir || MIGRATIONS_DIR);

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
    } finally {
      client.release();
    }
  }
}

/**
 * Returns migration status without creating schema state silently.
 * Detects applied migrations that are missing from disk.
 * @param {object} [options]
 * @returns {Promise<Array<{version: string, name: string, status: string, appliedAt: Date|null}>>}
 */
async function getMigrationStatus(options = {}) {
  const pool = options.poolOverride || getPool();
  const client = await pool.connect();

  try {
    const tableExists = await checkMigrationsTableExists(client);
    let appliedMap = new Map();

    if (tableExists) {
      const { rows: appliedRows } = await client.query(
        'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
      );
      appliedMap = new Map(appliedRows.map(r => [r.version, r]));
    }

    const migrationFiles = loadMigrationFiles(options.migrationsDir || MIGRATIONS_DIR);
    const diskVersions = new Set(migrationFiles.map(f => f.version));

    const statuses = migrationFiles.map(file => {
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

    // Detect migrations in DB that are missing from disk
    for (const [version, applied] of appliedMap.entries()) {
      if (!diskVersions.has(version)) {
        statuses.push({
          version,
          name: applied.name,
          filename: `(missing from disk)`,
          status: 'missing_from_disk',
          appliedAt: applied.applied_at,
          checksum: applied.checksum
        });
      }
    }

    statuses.sort((a, b) => a.version.localeCompare(b.version));
    return statuses;
  } finally {
    client.release();
  }
}

/**
 * Rolls back the latest applied migration.
 * Requires explicit confirmation in production.
 * @param {object} [options]
 * @param {boolean} [options.confirm]
 * @returns {Promise<{version: string, name: string, status: string}>}
 */
async function rollbackLatestMigration(options = {}) {
  if (process.env.NODE_ENV === 'production' && !options.confirm) {
    throw new Error('Rollback in production requires explicit confirmation (confirm: true).');
  }

  const pool = options.poolOverride || getPool();
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [ADVISORY_LOCK_KEY_1, ADVISORY_LOCK_KEY_2]);

    const tableExists = await checkMigrationsTableExists(client);
    if (!tableExists) {
      return { status: 'no_migrations_to_rollback' };
    }

    const { rows } = await client.query(
      'SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1'
    );

    if (rows.length === 0) {
      return { status: 'no_migrations_to_rollback' };
    }

    const latest = rows[0];
    const migrationFiles = loadMigrationFiles(options.migrationsDir || MIGRATIONS_DIR);
    const file = migrationFiles.find(f => f.version === latest.version);

    if (!file || !file.downFilepath) {
      throw new Error(`Cannot rollback migration ${latest.version}_${latest.name}: No matching down file found on disk.`);
    }

    const downSql = fs.readFileSync(file.downFilepath, 'utf8');
    if (!downSql.trim()) {
      throw new Error(`Cannot rollback migration ${latest.version}_${latest.name}: Down file is empty.`);
    }

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
    } finally {
      client.release();
    }
  }
}

module.exports = {
  runMigrations,
  getMigrationStatus,
  rollbackLatestMigration,
  calculateChecksum,
  loadMigrationFiles
};
