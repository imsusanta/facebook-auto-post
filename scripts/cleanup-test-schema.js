'use strict';
const fs = require('fs');
const { Pool } = require('pg');
const { resolveTestDatabaseUrl, assertLeastPrivilegedTestRole } = require('../db/safety-guard');
async function main() {
  const manifest = process.env.PG_TEST_SCHEMA_FILE;
  if (!manifest || !fs.existsSync(manifest)) return;
  const schema = fs.readFileSync(manifest, 'utf8').trim();
  if (!/^test_schema_[0-9]+_[a-f0-9]{8}$/.test(schema)) throw new Error('Invalid test schema manifest');
  const pool = new Pool({ connectionString: resolveTestDatabaseUrl(), connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  try {
    await assertLeastPrivilegedTestRole(pool);
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    fs.unlinkSync(manifest);
  } finally { await pool.end(); }
}
main().catch(() => { console.error('Test schema cleanup failed; no credentials logged.'); process.exitCode = 1; });
