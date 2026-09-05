'use strict';
const crypto = require('crypto');
const { query, withTransaction } = require('../db');
const TOKEN = /^[a-f0-9]{64}$/;
function digest(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function cookieName() { return process.env.NODE_ENV === 'production' ? '__Host-saas_session' : 'saas_session'; }
function cookieToken(req) {
  const { parseCookies } = require('../middleware/auth');
  return parseCookies(req.headers.cookie)[cookieName()];
}
function setCookie(res, token, clear = false) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${clear ? 0 : 86400}`);
  res.setHeader('Cache-Control', 'no-store');
}
async function create(userId, oldToken, expectedPasswordHash, expectedAuthVersion, upgradedHash = null, requestId = null) {
  return withTransaction(async client => {
    // Recheck identity after password verification; serialize against suspension,
    // deletion, and password changes before issuing any session.
    const { rows } = await client.query("SELECT id, auth_version FROM users WHERE id = $1 AND status = 'active' AND deleted_at IS NULL AND email_verified_at IS NOT NULL AND password_hash = $2 AND auth_version = $3 FOR UPDATE", [userId, expectedPasswordHash, expectedAuthVersion]);
    if (!rows[0]) return null;
    const events = require('../repositories/account-security-repository');
    if (upgradedHash) {
      await client.query("UPDATE users SET password_hash = $2, password_algorithm = 'argon2id', updated_at = NOW() WHERE id = $1", [userId, upgradedHash]);
      await events.record(client, rows[0], 'password.hash_upgraded', requestId);
    }
    if (TOKEN.test(oldToken || '')) await client.query('DELETE FROM auth_sessions WHERE token_hash = $1 AND user_id = $2', [digest(oldToken), userId]);
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1 AND expires_at <= NOW()', [userId]);
    const token = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    await client.query("INSERT INTO auth_sessions (token_hash, user_id, csrf_token, expires_at, auth_version) VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours', $4)", [digest(token), userId, csrfToken, rows[0].auth_version]);
    await events.record(client, rows[0], 'session.created', requestId);
    return { token, csrfToken };
  });
}
async function read(token) {
  if (!TOKEN.test(token || '')) return null;
  const { rows } = await query(`SELECT s.csrf_token, u.id, u.email FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.auth_version = u.auth_version AND s.expires_at > clock_timestamp() AND u.status = 'active' AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL`, [digest(token)]);
  if (!rows[0]) return null;
  return { csrfToken: rows[0].csrf_token, user: { id: rows[0].id, email: rows[0].email, role: 'user' } };
}
async function destroy(token) {
  if (TOKEN.test(token || '')) await query('DELETE FROM auth_sessions WHERE token_hash = $1', [digest(token)]);
}
function csrfValid(req, session) {
  const { safeCompare } = require('../middleware/auth');
  const { isOriginAllowed } = require('../utils/cors-validator');
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try { if (!isOriginAllowed(new URL(origin).origin)) return false; } catch { return false; }
  }
  return safeCompare(req.headers['x-csrf-token'], session.csrfToken);
}
async function authenticate(req, res, next) {
  try {
    const session = await read(cookieToken(req));
    if (!session) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Authentication required.' });
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !csrfValid(req, session)) return res.status(403).json({ code: 'CSRF_TOKEN_INVALID', error: 'Invalid or missing CSRF token.' });
    req.user = session.user;
    req.session = session;
    req.authType = 'postgres-cookie';
    next();
  } catch (err) {
    require('../utils/safe-diagnostics')('authentication.session', err);
    res.status(503).json({ code: 'AUTH_UNAVAILABLE', error: 'Authentication temporarily unavailable.' });
  }
}
module.exports = { create, read, destroy, cookieName, cookieToken, setCookie, csrfValid, authenticate };
