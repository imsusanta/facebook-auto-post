/**
 * Authentication Routes
 * Provides login, logout, and session status endpoints using HttpOnly cookies.
 */

const express = require('express');
const router = express.Router();
const {
  safeCompare,
  createSession,
  validateSession,
  destroySession,
  parseCookies
} = require('../middleware/auth');

// POST /api/auth/login - Authenticate with admin key and set session cookie
router.post('/login', (req, res) => {
  const { key } = req.body || {};
  const expectedKey = process.env.ADMIN_API_KEY;

  if (!expectedKey || typeof expectedKey !== 'string' || !expectedKey.trim()) {
    return res.status(500).json({
      success: false,
      error: 'Authentication configuration is missing on the server.',
      code: 'AUTH_CONFIG_MISSING'
    });
  }

  if (typeof key !== 'string' || !safeCompare(key.trim(), expectedKey.trim())) {
    return res.status(401).json({
      success: false,
      error: 'Invalid admin credentials.',
      code: 'INVALID_CREDENTIALS'
    });
  }

  const sessionId = createSession();
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  const cookieHeader = `auth_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=86400`;

  res.setHeader('Set-Cookie', cookieHeader);
  return res.json({
    success: true,
    authenticated: true
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
      bypass: true
    });
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.auth_session;
  const isValid = sessionId ? validateSession(sessionId) : false;

  return res.json({
    success: true,
    authenticated: isValid,
    bypass: false
  });
});

module.exports = router;
