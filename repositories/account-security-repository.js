'use strict';
const { randomUUID } = require('crypto');
const ACTIONS = new Set(['account.registered', 'verification.requested', 'email.verified', 'recovery.requested', 'password.reset', 'password.changed', 'sessions.revoked', 'account.suspended', 'account.deleted', 'password.hash_upgraded', 'session.created']);
async function record(client, user, action, requestId = null) {
  if (!client || !ACTIONS.has(action)) throw new Error('Invalid account event');
  // No arbitrary metadata/credential fields accepted. Raw caller IDs are never
  // stored; only the server-owned request ID shape is allowed.
  const safeId = typeof requestId === 'string' && /^req_[a-f0-9-]{36}$/.test(requestId) ? requestId : null;
  await client.query('INSERT INTO account_security_events (id, user_id, action, auth_version, request_id) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), user.id, action, user.auth_version, safeId]);
}
module.exports = { record };
