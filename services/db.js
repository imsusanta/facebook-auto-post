// No seeded users or default passwords. All SQL values use parameters.
const { Pool } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl:
    process.env.DATABASE_SSL === 'require'
      ? { rejectUnauthorized: true }
      : undefined
});
const transactionContext = new AsyncLocalStorage();
function query(text, values) {
  return (transactionContext.getStore() || pool).query(text, values);
}
async function transaction(fn, workspaceId) {
  if (transactionContext.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (workspaceId)
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [workspaceId]
      );
    const result = await transactionContext.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { query, transaction, pool };
