const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const db = require('../services/db');
const context = require('./context');
const { production, APP_ORIGIN } = require('../config/env');
const COOKIE = production ? '__Host-autopost' : 'autopost_session';
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
async function passwordHash(password) {
  const salt = random();
  const result = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${result.toString('hex')}`;
}
async function checkPassword(password, encoded) {
  if (!encoded) {
    await scrypt(password, 'dummy-password-timing-salt', 64);
    return false;
  }
  const [scheme, salt, digest] = encoded.split(':');
  if (scheme !== 'scrypt') return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}
function cookieToken(req) {
  const raw = (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + '='));
  return raw?.slice(COOKIE.length + 1) || '';
}
async function session(req) {
  const token = cookieToken(req);
  if (!/^[a-f\d]{64}$/.test(token)) return null;
  const { rows } = await db.query(
    `SELECT s.token_hash,s.csrf_token,s.workspace_id,u.id,u.email,u.name,u.email_verified_at,m.role
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspace_members m ON m.user_id=u.id AND m.workspace_id=s.workspace_id
    WHERE s.token_hash=$1 AND s.expires_at>now()`,
    [hash(token)]
  );
  return rows[0] || null;
}
async function createSession(res, userId, workspaceId) {
  const token = random(),
    csrf = random();
  await db.query(
    "INSERT INTO sessions(token_hash,csrf_token,user_id,workspace_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')",
    [hash(token), csrf, userId, workspaceId]
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  return csrf;
}
function clearCookie(res) {
  res.clearCookie(COOKIE, {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/'
  });
}
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('origin') !== APP_ORIGIN)
    return res.status(403).json({ error: 'Same-origin request required' });
  next();
}
async function authenticate(req, res, next) {
  const user = await session(req);
  if (!user || !user.email_verified_at)
    return res
      .status(401)
      .json({ error: 'Sign in with a verified email to continue' });
  req.user = user;
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.get('x-csrf-token') !== user.csrf_token
  )
    return res.status(403).json({ error: 'Invalid CSRF token' });
  return context.run(user.workspace_id, next, {
    userId: user.id,
    role: user.role
  });
}
function authorize(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.user.role === 'viewer')
    return res.status(403).json({ error: 'Read-only membership' });
  if (
    /^\/(workspace|settings|facebook\/pages|pages|facebook\/test-connection|test-connection|facebook\/refresh-logo|refresh-logo)(\/|$)/.test(
      req.path
    ) &&
    req.user.role !== 'owner'
  )
    return res
      .status(403)
      .json({ error: 'Workspace owner permission required' });
  next();
}
module.exports = {
  hash,
  random,
  passwordHash,
  checkPassword,
  session,
  createSession,
  clearCookie,
  sameOrigin,
  authenticate,
  authorize
};
