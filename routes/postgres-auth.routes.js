'use strict';
const express = require('express');
const rateLimit = require('../middleware/auth-rate-limit');
const passwords = require('../security/passwords');
const lifecycle = require('../services/account-lifecycle');
const router = express.Router();
const users = require('../repositories/user-repository');
const sessions = require('../services/postgres-session');
const { isOriginAllowed } = require('../utils/cors-validator');
const { resolveSafeRequestId } = require('../middleware/workspace-context');
const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
router.use((req, res, next) => {
  req.requestId = resolveSafeRequestId();
  res.setHeader('x-request-id', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  // Public production exposure remains blocked until onboarding, recovery,
  // distributed abuse controls and the rest of the SaaS launch gates are done.
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ code: 'NOT_FOUND' });
  next();
});
router.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!['/logout', '/logout-all', '/dev-login', '/setup'].includes(req.path) && !req.is('application/json')) return res.status(415).json({ code: 'JSON_REQUIRED', requestId: req.requestId });
    const origin = req.headers.origin || req.headers.referer;
    if (origin) {
      try { if (!isOriginAllowed(new URL(origin).origin)) return res.status(403).json({ code: 'FORBIDDEN_ORIGIN', requestId: req.requestId }); }
      catch { return res.status(403).json({ code: 'FORBIDDEN_ORIGIN', requestId: req.requestId }); }
    }
  }
  next();
});
const accepted = (req, res) => res.status(202).json({ success: true, message: 'If the request is eligible, an email will be sent.', requestId: req.requestId });
router.post('/signup', rateLimit('signup'), wrap(async (req, res) => { await lifecycle.signup(req.body || {}, req.requestId); return accepted(req, res); }));
router.post('/resend-verification', rateLimit('resend'), wrap(async (req, res) => { await lifecycle.requestAction(req.body?.email, 'verify_email', req.requestId); return accepted(req, res); }));
router.post('/forgot-password', rateLimit('recovery'), wrap(async (req, res) => { await lifecycle.requestAction(req.body?.email, 'reset_password', req.requestId); return accepted(req, res); }));
router.post('/verify-email', rateLimit('action'), wrap(async (req, res) => { await lifecycle.verifyEmail(req.body?.token, req.requestId); res.json({ success: true, requestId: req.requestId }); }));
router.post('/reset-password', rateLimit('action'), wrap(async (req, res) => { await lifecycle.resetPassword(req.body?.token, req.body?.password, req.requestId); res.json({ success: true, reauthenticationRequired: true, requestId: req.requestId }); }));
router.post('/change-password', rateLimit('change'), sessions.authenticate, wrap(async (req, res) => {
  await lifecycle.changePassword(req.user.id, sessions.cookieToken(req), req.body?.currentPassword, req.body?.newPassword, req.requestId);
  sessions.setCookie(res, '', true);
  res.json({ success: true, reauthenticationRequired: true, requestId: req.requestId });
}));
router.post('/logout-all', rateLimit('change'), sessions.authenticate, wrap(async (req, res) => {
  await lifecycle.logoutAll(req.user.id, sessions.cookieToken(req), req.requestId);
  sessions.setCookie(res, '', true);
  res.json({ success: true, authenticated: false, requestId: req.requestId });
}));
router.post('/login', rateLimit('login'), wrap(async (req, res) => {
  if (req.headers.origin) {
    let allowed = false;
    try { allowed = isOriginAllowed(new URL(req.headers.origin).origin); } catch { /* fail closed */ }
    if (!allowed) return res.status(403).json({ code: 'FORBIDDEN_ORIGIN' });
  }
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || !password || password.length > 1024) return res.status(401).json({ code: 'INVALID_CREDENTIALS', error: 'Invalid email or password.' });
  const user = await users.findByEmail(email);
  const valid = user ? await users.verifyPassword(user, password) : (await passwords.dummyVerify(password), false);
  if (!valid || !user || user.status !== 'active' || user.deleted_at !== null || !user.email_verified_at) return res.status(401).json({ code: 'INVALID_CREDENTIALS', error: 'Invalid email or password.' });
  const upgradedHash = user.password_hash.startsWith('pbkdf2_sha512$') ? await passwords.hash(password, false) : null;
  const session = await sessions.create(user.id, sessions.cookieToken(req), user.password_hash, user.auth_version, upgradedHash, req.requestId);
  if (!session) return res.status(401).json({ code: 'INVALID_CREDENTIALS', error: 'Invalid email or password.' });
  sessions.setCookie(res, session.token);
  return res.json({ success: true, authenticated: true, csrfToken: session.csrfToken, user: { id: user.id, email: user.email, role: 'user' } });
}));
router.get('/session', rateLimit('session'), wrap(async (req, res) => {
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
  if (err instanceof lifecycle.IdentityError) {
    const status = err.code === 'AUTH_REQUIRED' ? 401 : 400;
    return res.status(status).json({ code: err.code, error: 'The request is invalid or unavailable.', requestId: req.requestId });
  }
  if (err instanceof passwords.PasswordPolicyError) return res.status(400).json({ code: 'INPUT_INVALID', error: 'Password must be at least 12 characters and no more than 1024 UTF-8 bytes.', requestId: req.requestId });
  require('../utils/safe-diagnostics')('authentication.route', err, req.requestId);
  res.status(503).json({ code: 'AUTH_UNAVAILABLE', error: 'Authentication temporarily unavailable.', requestId: req.requestId });
});
module.exports = router;
