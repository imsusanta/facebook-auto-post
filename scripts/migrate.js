'use strict';

require('dotenv').config();
const { runMigrations, getMigrationStatus, rollbackLatestMigration } = require('../db/migrator');
const { closePool } = require('../db/index');

function sanitizeError(msg) {
  if (!msg || typeof msg !== 'string') return 'Unknown error';
  return msg.replace(/postgres:\/\/[^@\s]+:[^@\s]+@/g, 'postgres://[REDACTED]:[REDACTED]@');
}

async function main() {
  const args = process.argv.slice(2);
  const isStatus = args.includes('--status');
  const isRollback = args.includes('--rollback');
  const isConfirm = args.includes('--confirm');

  try {
    if (isStatus) {
      console.log('🔍 Checking PostgreSQL migration status...');
      const statuses = await getMigrationStatus();
      console.table(statuses.map(s => ({
        Version: s.version,
        Name: s.name,
        Status: s.status.toUpperCase(),
        'Applied At': s.appliedAt ? s.appliedAt.toISOString() : 'PENDING'
      })));
    } else if (isRollback) {
      console.log('⚠️ Rolling back latest applied PostgreSQL migration...');
      const result = await rollbackLatestMigration({ confirm: isConfirm });
      console.log(`✅ Rollback result: ${result.status} (${result.version || 'none'})`);
    } else {
      console.log('🚀 Running pending PostgreSQL migrations...');
      const results = await runMigrations();
      for (const res of results) {
        console.log(`  [${res.status.toUpperCase()}] Migration ${res.version}: ${res.name}`);
      }
      console.log('✅ All migrations verified and up to date.');
    }
  } catch (err) {
    console.error('❌ Migration failed:', sanitizeError(err.message));
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
