require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../services/db');
async function migrate() {
  await db.transaction(async () => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('autopost:migrations', 0))"
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const dir = path.join(__dirname, '..', 'db', 'migrations');
    for (const name of (await fs.readdir(dir))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      if (
        (
          await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [
            name
          ])
        ).rowCount
      )
        continue;
      await db.query(await fs.readFile(path.join(dir, name), 'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
  });
}
if (require.main === module)
  migrate()
    .then(() => db.pool.end())
    .catch(async () => {
      console.error(
        'Migration failed; inspect database configuration and schema.'
      );
      await db.pool.end();
      process.exitCode = 1;
    });
module.exports = migrate;
