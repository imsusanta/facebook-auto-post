'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const users = require('../repositories/user-repository');
const sessions = require('../services/postgres-session');
const { isOriginAllowed } = require('../utils/cors-validator');
const { resolveSafeRequestId } = require('../middleware/workspace-context');
const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
const dummy = `pbkdf2_sha512$100000$${'0'.repeat(32)}$${'0'.repeat(128)}`;
router.use((req, res, next) => {
  req.requestId = resolveSafeRequestId();
  res.setHeader('x-request-id', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  // Public production exposure remains blocked until onboarding, recovery,
  // distributed abuse controls and the rest of the SaaS launch gates are done.
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ code: 'NOT_FOUND' });
  next();
});
router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }), wrap(async (req, res) => {
  if (req.headers.origin) {
    let allowed = false;
    try { allowed = isOriginAllowed(new URL(req.headers.origin).origin); } catch { /* fail closed */ }
    if (!allowed) return res.status(403).json({ code: 'FORBIDDEN_ORIGIN' });
  }
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || !password || password.length > 1024) return res.status(401).json({ code: 'INVALID_CREDENTIALS', error: 'Invalid email or password.' });
  const user = await users.findByEmail(email);
  const valid = users.verifyPassword(user || { password_hash: dummy }, password);
  if (!valid || !user || user.status !== 'active' || user.deleted_at !== null || !user.email_verified_at) return res.status(401).json({ code: 'INVALID_CREDENTIALS', error: 'Invalid email or password.' });
  const session = await sessions.create(user.id, sessions.cookieToken(req), user.password_hash);
  if (!session) return res.status(401).json({ code: 'INVALID_CREDENTIALS', error: 'Invalid email or password.' });
  sessions.setCookie(res, session.token);
  return res.json({ success: true, authenticated: true, csrfToken: session.csrfToken, user: { id: user.id, email: user.email, role: 'user' } });
}));
router.get('/session', wrap(async (req, res) => {
  const session = await sessions.read(sessions.cookieToken(req));
  return res.json(session ? { success: true, authenticated: true, ...session } : { success: true, authenticated: false, user: null });
}));
router.post('/logout', sessions.authenticate, wrap(async (req, res) => {
  await sessions.destroy(sessions.cookieToken(req));
  sessions.setCookie(res, '', true);
  res.json({ success: true, authenticated: false });
}));
// No fallback to legacy setup, development login, or admin-key authentication.
router.use((req, res) => res.status(404).json({ code: 'NOT_FOUND' }));
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  require('../utils/safe-diagnostics')('authentication.route', err, req.requestId);
  res.status(503).json({ code: 'AUTH_UNAVAILABLE', error: 'Authentication temporarily unavailable.', requestId: req.requestId });
});
module.exports = router;
