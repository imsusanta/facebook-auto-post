/**
 * Authentication Routes
 * Provides login, setup, logout, and session status endpoints using HttpOnly cookies.
 */

const express = require('express');
const router = express.Router();
const storage = require('../services/storage');
const {
  safeCompare,
  createSession,
  validateSession,
  destroySession,
  parseCookies,
  hashPassword,
  verifyPassword,
  isAuthConfigured
} = require('../middleware/auth');

// Helper to set session cookie
function setAuthCookie(res, sessionId) {
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  const cookieHeader = `auth_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=86400`;
  res.setHeader('Set-Cookie', cookieHeader);
}

// POST /api/auth/login - Authenticate with admin password or key and set session cookie
router.post('/login', (req, res) => {
  const { key, password } = req.body || {};
  const candidate = typeof password === 'string' && password.trim()
    ? password.trim()
    : (typeof key === 'string' ? key.trim() : '');

  if (!candidate) {
    return res.status(400).json({
      success: false,
      error: 'Please enter your admin password or key.',
      code: 'CREDENTIAL_REQUIRED'
    });
  }

  const expectedEnvKey = process.env.ADMIN_API_KEY;
  let authenticated = false;

  // 1. Check environment ADMIN_API_KEY
  if (expectedEnvKey && typeof expectedEnvKey === 'string' && expectedEnvKey.trim()) {
    if (safeCompare(candidate, expectedEnvKey.trim())) {
      authenticated = true;
    }
  }

  // 2. Check stored admin password hash
  if (!authenticated) {
    const adminAuth = storage.getAdminAuth();
    if (adminAuth.hasPassword) {
      if (verifyPassword(candidate, adminAuth.hash, adminAuth.salt)) {
        authenticated = true;
      }
    }
  }

  // If server has no auth configured at all
  if (!isAuthConfigured()) {
    return res.status(400).json({
      success: false,
      error: 'Admin authentication is not configured yet. Please complete initial setup.',
      code: 'AUTH_CONFIG_MISSING',
      setupRequired: true
    });
  }

  if (!authenticated) {
    return res.status(401).json({
      success: false,
      error: 'Invalid admin credentials.',
      code: 'INVALID_CREDENTIALS'
    });
  }

  const sessionId = createSession();
  setAuthCookie(res, sessionId);

  return res.json({
    success: true,
    authenticated: true
  });
});

// POST /api/auth/setup - First-time admin password setup (only when unconfigured)
router.post('/setup', (req, res) => {
  if (isAuthConfigured()) {
    return res.status(403).json({
      success: false,
      error: 'Admin authentication is already configured on this server.',
      code: 'AUTH_ALREADY_CONFIGURED'
    });
  }

  const { password, confirmPassword } = req.body || {};
  if (!password || typeof password !== 'string' || password.trim().length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Admin password must be at least 6 characters long.',
      code: 'PASSWORD_TOO_SHORT'
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      error: 'Passwords do not match.',
      code: 'PASSWORDS_MISMATCH'
    });
  }

  const { hash, salt } = hashPassword(password.trim());
  storage.setAdminPassword(hash, salt);

  const sessionId = createSession();
  setAuthCookie(res, sessionId);

  return res.json({
    success: true,
    authenticated: true,
    message: 'Admin password successfully set up.'
  });
});

// POST /api/auth/dev-login - One-click dev login for non-production environments
router.post('/dev-login', (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    return res.status(403).json({
      success: false,
      error: 'Development login is not permitted in production.',
      code: 'DEV_LOGIN_FORBIDDEN'
    });
  }

  const sessionId = createSession();
  setAuthCookie(res, sessionId);

  return res.json({
    success: true,
    authenticated: true,
    devMode: true
  });
});

// POST /api/auth/logout - Invalidate active session and clear cookie
router.post('/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.auth_session;
  if (sessionId) {
    destroySession(sessionId);
  }

  res.setHeader('Set-Cookie', 'auth_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return res.json({
    success: true,
    authenticated: false
  });
});

// GET /api/auth/session - Check authentication state
router.get('/session', (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const devBypass = !isProduction && process.env.DEV_AUTH_BYPASS === 'true';

  if (devBypass) {
    return res.json({
      success: true,
      authenticated: true,
      bypass: true,
      setupRequired: false,
      isDev: true
    });
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.auth_session;
  const isValid = sessionId ? validateSession(sessionId) : false;
  const configured = isAuthConfigured();

  return res.json({
    success: true,
    authenticated: isValid,
    bypass: false,
    setupRequired: !configured,
    isDev: !isProduction
  });
});

module.exports = router;
