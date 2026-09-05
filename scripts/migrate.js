const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config/env');
const db = require('../services/db');
async function files() {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  return Promise.all(
    (await fs.readdir(dir))
      .filter((n) => n.endsWith('.sql'))
      .sort()
      .map(async (name) => {
        const sql = await fs.readFile(path.join(dir, name), 'utf8');
        return {
          name,
          sql,
          checksum: crypto.createHash('sha256').update(sql).digest('hex')
        };
      })
  );
}
async function migrate() {
  config.validateDatabase();
  await db.transaction(async () => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('autopost:migrations',0))"
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now(),checksum text)'
    );
    await db.query(
      'ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text'
    );
    for (const file of await files()) {
      const existing = (
        await db.query('SELECT checksum FROM schema_migrations WHERE name=$1', [
          file.name
        ])
      ).rows[0];
      if (existing) {
        if (existing.checksum && existing.checksum !== file.checksum)
          throw new Error(`Applied migration changed: ${file.name}`);
        if (!existing.checksum)
          await db.query(
            'UPDATE schema_migrations SET checksum=$1 WHERE name=$2',
            [file.checksum, file.name]
          );
        continue;
      }
      await db.query(file.sql);
      await db.query(
        'INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',
        [file.name, file.checksum]
      );
    }
  });
}
async function status() {
  config.validateDatabase();
  const expected = await files();
  const exists = (
    await db.query(
      "SELECT to_regclass('schema_migrations') IS NOT NULL AS present"
    )
  ).rows[0].present;
  if (!exists) return expected.map((f) => ({ name: f.name, state: 'pending' }));
  const columns = await db.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='schema_migrations' AND column_name='checksum'"
  );
  const applied = (
    await db.query(
      columns.rowCount
        ? 'SELECT name,checksum FROM schema_migrations'
        : 'SELECT name,NULL AS checksum FROM schema_migrations'
    )
  ).rows;
  const known = new Set(expected.map((f) => f.name));
  return [
    ...expected.map((f) => {
      const row = applied.find((a) => a.name === f.name);
      return {
        name: f.name,
        state: !row
          ? 'pending'
          : !row.checksum
            ? 'checksum_required'
            : row.checksum !== f.checksum
              ? 'changed'
              : 'applied'
      };
    }),
    ...applied
      .filter((a) => !known.has(a.name))
      .map((a) => ({ name: a.name, state: 'unknown' }))
  ];
}
async function assertCurrent() {
  const report = await status();
  if (report.some((r) => r.state !== 'applied'))
    throw new Error(
      'Database schema is not current; run npm run db:status and npm run db:migrate'
    );
}
if (require.main === module)
  (process.argv.includes('--status')
    ? status().then((report) => {
        console.table(report);
        if (report.some((r) => r.state !== 'applied')) process.exitCode = 1;
      })
    : migrate()
  )
    .catch(() => {
      console.error(
        'Migration/status check failed. Check database configuration and immutable migration files.'
      );
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
module.exports = migrate;
module.exports.status = status;
module.exports.assertCurrent = assertCurrent;
