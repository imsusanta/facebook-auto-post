const { Pool } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('../config/env');
const pool = new Pool(config.database);
pool.on('error', () => console.error('[Database] Idle connection failed'));
const transactionContext = new AsyncLocalStorage();
function query(text, values) {
  return (transactionContext.getStore()?.client || pool).query(text, values);
}
async function transaction(fn, workspaceId) {
  const parent = transactionContext.getStore();
  if (parent) {
    if (workspaceId && parent.workspaceId && workspaceId !== parent.workspaceId)
      throw new Error('Cannot change workspace within a transaction');
    return fn();
  }
  const client = await pool.connect();
  const state = { client, workspaceId, hooks: [] };
  let result;
  try {
    await client.query('BEGIN');
    if (workspaceId)
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [workspaceId]
      );
    result = await transactionContext.run(state, fn);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  for (const hook of state.hooks)
    try {
      await hook();
    } catch {
      console.warn('[Database] Post-commit notification failed');
    }
  return result;
}
function afterCommit(fn) {
  const state = transactionContext.getStore();
  if (state) {
    state.hooks.push(fn);
    return;
  }
  return fn();
}
module.exports = { query, transaction, afterCommit, pool };
