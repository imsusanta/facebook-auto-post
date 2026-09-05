'use strict';
const crypto = require('crypto');
const { query, withTransaction } = require('../db');
const passwords = require('../security/passwords');
const events = require('../repositories/account-security-repository');
const mail = require('./account-mail');
class IdentityError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code = 'ACTION_INVALID') { throw new IdentityError(code); }
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
function email(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) fail('INPUT_INVALID');
  return value.trim().toLowerCase();
}
function active(user) { return user && !user.deleted_at && user.status === 'active' && user.email_verified_at; }
async function lockUser(client, id) {
  const result = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
  return result.rows[0];
}
async function cancelTokens(client, userId, purpose = null) {
  await client.query('UPDATE auth_action_tokens SET revoked_at = NOW() WHERE user_id = $1 AND ($2::text IS NULL OR purpose = $2) AND consumed_at IS NULL AND revoked_at IS NULL', [userId, purpose]);
  await client.query("UPDATE auth_mail_outbox o SET state = 'cancelled', payload = NULL FROM auth_action_tokens t WHERE o.token_hash = t.token_hash AND t.user_id = $1 AND ($2::text IS NULL OR t.purpose = $2) AND o.state = 'pending'", [userId, purpose]);
}
async function issue(client, user, purpose) {
  await cancelTokens(client, user.id, purpose);
  const token = crypto.randomBytes(32).toString('hex');
  const digest = tokenHash(token);
  const ttlSeconds = purpose === 'verify_email' ? 86400 : 1800;
  await client.query("INSERT INTO auth_action_tokens (token_hash,user_id,purpose,auth_version,expires_at) VALUES ($1,$2,$3,$4,NOW()+($5 * INTERVAL '1 second'))", [digest, user.id, purpose, user.auth_version, ttlSeconds]);
  return mail.enqueue(client, user, purpose, digest, token);
}
async function signup(input, requestId) {
  mail.settings();
  const normalized = email(input.email);
  const passwordHash = await passwords.hash(input.password);
  const deliveryId = await withTransaction(async client => {
    // ON CONFLICT is essential: concurrent duplicate registration must not
    // replace an existing password or reveal whether an account exists.
    const result = await client.query("INSERT INTO users (id,email,email_normalized,password_hash,password_algorithm,status) VALUES ($1,$2,$2,$3,'argon2id','pending_verification') ON CONFLICT (email_normalized) DO NOTHING RETURNING *", [crypto.randomUUID(), normalized, passwordHash]);
    const user = result.rows[0];
    if (!user) return null;
    const id = await issue(client, user, 'verify_email');
    await events.record(client, user, 'account.registered', requestId);
    return id;
  });
  if (deliveryId) await mail.dispatch(deliveryId);
}
async function requestAction(address, purpose, requestId) {
  mail.settings();
  const normalized = email(address);
  const deliveryId = await withTransaction(async client => {
    const rows = await client.query('SELECT * FROM users WHERE email_normalized = $1 FOR UPDATE', [normalized]);
    const user = rows.rows[0];
    if (!user || user.deleted_at || user.status === 'suspended') return null;
    if (purpose === 'verify_email' && (user.email_verified_at || !['pending_verification', 'active'].includes(user.status))) return null;
    if (purpose === 'reset_password' && !active(user)) return null;
    const id = await issue(client, user, purpose);
    await events.record(client, user, purpose === 'verify_email' ? 'verification.requested' : 'recovery.requested', requestId);
    return id;
  });
  if (deliveryId) await mail.dispatch(deliveryId);
}
async function consume(raw, purpose, newPasswordHash, requestId) {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) fail();
  const hash = tokenHash(raw);
  const discovered = await query('SELECT user_id FROM auth_action_tokens WHERE token_hash = $1 AND purpose = $2', [hash, purpose]);
  if (!discovered.rows[0]) fail();
  return withTransaction(async client => {
    const user = await lockUser(client, discovered.rows[0].user_id);
    if (!user || user.deleted_at || user.status === 'suspended') fail();
    if (purpose === 'reset_password' && !active(user)) fail();
    if (purpose === 'verify_email' && (user.email_verified_at || !['active', 'pending_verification'].includes(user.status))) fail();
    // DB clock and conditional update, not a stale application time check.
    const changed = await client.query('UPDATE auth_action_tokens SET consumed_at = NOW() WHERE token_hash = $1 AND purpose = $2 AND user_id = $3 AND auth_version = $4 AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at > clock_timestamp() RETURNING token_hash', [hash, purpose, user.id, user.auth_version]);
    if (!changed.rowCount) fail();
    if (purpose === 'verify_email') {
      await client.query("UPDATE users SET status = 'active', email_verified_at = NOW(), updated_at = NOW() WHERE id = $1", [user.id]);
      await cancelTokens(client, user.id, 'verify_email');
      await events.record(client, user, 'email.verified', requestId);
    } else {
      const changedUser = await client.query("UPDATE users SET password_hash = $2, password_algorithm = 'argon2id', password_updated_at = NOW(), auth_version = auth_version + 1, updated_at = NOW() WHERE id = $1 RETURNING *", [user.id, newPasswordHash]);
      await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [user.id]);
      await cancelTokens(client, user.id);
      await events.record(client, changedUser.rows[0], 'password.reset', requestId);
    }
  });
}
async function verifyEmail(token, requestId) { return consume(token, 'verify_email', null, requestId); }
async function resetPassword(token, password, requestId) {
  const hash = await passwords.hash(password);
  return consume(token, 'reset_password', hash, requestId);
}
async function requireCurrentSession(client, user, rawSession) {
  if (!active(user) || typeof rawSession !== 'string' || !/^[a-f0-9]{64}$/.test(rawSession)) fail('AUTH_REQUIRED');
  const found = await client.query('SELECT token_hash FROM auth_sessions WHERE user_id = $1 AND token_hash = $2 AND auth_version = $3 AND expires_at > clock_timestamp() FOR UPDATE', [user.id, tokenHash(rawSession), user.auth_version]);
  if (!found.rowCount) fail('AUTH_REQUIRED');
}
async function changePassword(userId, rawSession, currentPassword, newPassword, requestId) {
  const found = await query('SELECT * FROM users WHERE id = $1', [userId]);
  const original = found.rows[0];
  if (!active(original) || !(await passwords.verify(original.password_hash, currentPassword))) fail('CURRENT_PASSWORD_INVALID');
  const hash = await passwords.hash(newPassword);
  return withTransaction(async client => {
    const user = await lockUser(client, userId);
    await requireCurrentSession(client, user, rawSession);
    if (user.password_hash !== original.password_hash || user.auth_version !== original.auth_version) fail('AUTH_REQUIRED');
    const changed = await client.query("UPDATE users SET password_hash = $2, password_algorithm = 'argon2id', password_updated_at = NOW(), auth_version = auth_version + 1, updated_at = NOW() WHERE id = $1 RETURNING *", [userId, hash]);
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
    await cancelTokens(client, userId);
    await events.record(client, changed.rows[0], 'password.changed', requestId);
  });
}
async function logoutAll(userId, rawSession, requestId) {
  return withTransaction(async client => {
    const user = await lockUser(client, userId);
    await requireCurrentSession(client, user, rawSession);
    const changed = await client.query('UPDATE users SET auth_version = auth_version + 1, updated_at = NOW() WHERE id = $1 RETURNING *', [userId]);
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
    // Invalidate previously issued recovery links as well as all old cookies.
    await cancelTokens(client, userId);
    await events.record(client, changed.rows[0], 'sessions.revoked', requestId);
  });
}
// Trusted internal repository boundary only. No HTTP route grants an ordinary
// SaaS caller permission to suspend/delete an arbitrary account.
async function makeInactive(userId, deleted = false, requestId = null, clientOverride = null) {
  const execute = async client => {
    const user = await lockUser(client, userId);
    if (!user || user.deleted_at) return false;
    const changed = await client.query("UPDATE users SET status = 'suspended', deleted_at = CASE WHEN $2 THEN NOW() ELSE deleted_at END, auth_version = auth_version + 1, updated_at = NOW() WHERE id = $1 RETURNING *", [userId, deleted]);
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
    await cancelTokens(client, userId);
    await events.record(client, changed.rows[0], deleted ? 'account.deleted' : 'account.suspended', requestId);
    return true;
  };
  return clientOverride ? execute(clientOverride) : withTransaction(execute);
}
module.exports = { IdentityError, signup, requestAction, verifyEmail, resetPassword, changePassword, logoutAll, makeInactive };
