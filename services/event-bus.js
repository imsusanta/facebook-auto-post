// PostgreSQL NOTIFY is an invalidation/live-event transport, not a durable job queue.
const { Client } = require('pg');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const db = require('./db');
const config = require('../config/env');
const emitter = new EventEmitter(),
  source = randomUUID(),
  channel = 'autopost_events';
let client,
  retry,
  stopped = true;
function receive(message) {
  try {
    const value = JSON.parse(message.payload);
    if (value.source === source || value.v !== 1) return;
    if (!['event', 'revoke_session', 'revoke_user'].includes(value.kind))
      return;
    if (
      value.kind === 'event' &&
      (!/^[a-f\d-]{36}$/.test(value.workspaceId) ||
        !/^[a-z_]{1,64}$/.test(value.event))
    )
      return;
    emitter.emit('message', value);
  } catch {
    /* Ignore malformed notifications from other database clients. */
  }
}
async function connect() {
  const connection = new Client(config.database);
  client = connection;
  const lost = () => {
    if (client !== connection) return;
    client = null;
    connection.removeAllListeners('notification');
    connection.end().catch(() => {});
    if (!stopped && !retry) {
      retry = setTimeout(() => {
        retry = null;
        connect().catch(() => {});
      }, 1000);
      retry.unref();
    }
  };
  connection.on('error', lost);
  connection.on('end', lost);
  connection.on('notification', receive);
  try {
    await connection.connect();
    await connection.query(`LISTEN ${channel}`);
    emitter.emit('message', { kind: 'resync' });
  } catch (error) {
    lost();
    throw error;
  }
}
async function start() {
  if (!stopped) return;
  stopped = false;
  await connect();
}
async function stop() {
  stopped = true;
  if (retry) clearTimeout(retry);
  retry = null;
  const old = client;
  client = null;
  if (old) await old.end();
}
function publish(message) {
  const envelope = { ...message, v: 1, source };
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > 7500) {
    envelope.event = 'state_invalidated';
    envelope.data = { reason: 'refresh' };
  }
  const dispatch = async () => {
    emitter.emit('message', envelope);
    try {
      await db.query('SELECT pg_notify($1,$2)', [
        channel,
        JSON.stringify(envelope)
      ]);
    } catch {
      console.warn(
        '[Events] Shared notification unavailable; clients must refresh'
      );
    }
  };
  return db.afterCommit(dispatch);
}
module.exports = {
  start,
  stop,
  publish,
  subscribe(fn) {
    emitter.on('message', fn);
    return () => emitter.off('message', fn);
  }
};
