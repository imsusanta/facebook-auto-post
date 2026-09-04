/**
 * API Authentication Middleware & Session Management
 * Enforces admin key authentication, session cookies, and fails closed in all environments
 * unless explicit development bypass is set.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

// In-memory session store: Map<sessionId, { createdAt: number, expiresAt: number }>
const activeSessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Track whether bypass warning has been logged
let bypassWarningLogged = false;

/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Parse cookies from request header
 */
function parseCookies(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return {};
  const cookies = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch (e) {
      cookies[key] = val;
    }
  }
  return cookies;
}

/**
 * Session Store Management
 */
function createSession() {
  // Prune expired sessions
  const now = Date.now();
  for (const [id, s] of activeSessions.entries()) {
    if (s.expiresAt <= now) activeSessions.delete(id);
  }

  const sessionId = crypto.randomBytes(32).toString('hex');
  activeSessions.set(sessionId, {
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS
  });
  return sessionId;
}

function validateSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false;
  const session = activeSessions.get(sessionId);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    activeSessions.delete(sessionId);
    return false;
  }
  return true;
}

function destroySession(sessionId) {
  if (sessionId && activeSessions.has(sessionId)) {
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}

function clearAllSessions() {
  activeSessions.clear();
}

/**
 * Detect forbidden query credentials
 */
const FORBIDDEN_QUERY_KEYS = new Set([
  'apikey',
  'api_key',
  'token',
  'key',
  'adminkey',
  'admin_key',
  'password',
  'secret',
  'accesstoken',
  'access_token'
]);

function hasQueryCredentials(query) {
  if (!query || typeof query !== 'object') return false;
  for (const k of Object.keys(query)) {
    const normalized = k.toLowerCase().replace(/[-_]/g, '');
    if (FORBIDDEN_QUERY_KEYS.has(k.toLowerCase()) || FORBIDDEN_QUERY_KEYS.has(normalized)) {
      return true;
    }
  }
  return false;
}

/**
 * Authentication Middleware
 */
function authMiddleware(req, res, next) {
  // 1. Check for forbidden query-string credentials
  if (hasQueryCredentials(req.query)) {
    return res.status(400).json({
      success: false,
      error: 'Authentication credentials must never be passed in URL query parameters.',
      code: 'CREDENTIALS_IN_URL_FORBIDDEN'
    });
  }

  // 2. Allow Meta Webhook endpoint to bypass (Meta manages its own token & signature challenge)
  const path = req.path || '';
  const originalUrl = req.originalUrl || '';
  if (path === '/webhook' || path.startsWith('/webhook/') || originalUrl.startsWith('/api/webhook')) {
    return next();
  }

  // 3. Allow Public Auth Endpoints to bypass
  if (path === '/auth/login' || path === '/auth/status' || originalUrl.startsWith('/api/auth/login') || originalUrl.startsWith('/api/auth/status')) {
    return next();
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const devBypass = process.env.DEV_AUTH_BYPASS === 'true';
  const expectedKey = process.env.ADMIN_API_KEY;

  // 4. Development Bypass Check (ONLY allowed when NODE_ENV !== 'production' AND DEV_AUTH_BYPASS === 'true')
  if (!isProduction && devBypass) {
    if (!bypassWarningLogged) {
      logger.warn('[SECURITY WARNING] Development authentication bypass is active via DEV_AUTH_BYPASS=true. Do NOT use in production.');
      bypassWarningLogged = true;
    }
    return next();
  }

  // 5. Fail closed if ADMIN_API_KEY is not configured
  if (!expectedKey || typeof expectedKey !== 'string' || !expectedKey.trim()) {
    if (isProduction) {
      logger.error('[Security] Production server error: ADMIN_API_KEY is not configured. Failing closed.');
      return res.status(500).json({
        success: false,
        error: 'Server authentication configuration missing.',
        code: 'AUTH_CONFIG_MISSING'
      });
    } else {
      logger.error('[Security] Development authentication error: ADMIN_API_KEY is unset and DEV_AUTH_BYPASS is not "true". Failing closed.');
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Set ADMIN_API_KEY or set DEV_AUTH_BYPASS=true for local development.',
        code: 'AUTH_REQUIRED'
      });
    }
  }

  // 6. Check Session Cookie
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.auth_session;
  if (sessionId && validateSession(sessionId)) {
    return next();
  }

  // 7. Check Header Credentials (x-admin-key or Authorization: Bearer)
  const adminKeyHeader = req.headers['x-admin-key'];
  const authHeader = req.headers.authorization;

  let headerToken = null;
  if (typeof adminKeyHeader === 'string') {
    headerToken = adminKeyHeader.trim();
  } else if (typeof authHeader === 'string') {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && (parts[0].toLowerCase() === 'bearer' || parts[0].toLowerCase() === 'token')) {
      headerToken = parts[1].trim();
    } else {
      headerToken = authHeader.trim();
    }
  }

  if (headerToken && safeCompare(headerToken, expectedKey)) {
    return next();
  }

  // 8. Reject Unauthorized Request
  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Invalid or missing authentication credentials.',
    code: 'UNAUTHORIZED'
  });
}

module.exports = {
  authMiddleware,
  safeCompare,
  createSession,
  validateSession,
  destroySession,
  clearAllSessions,
  hasQueryCredentials,
  parseCookies
};
