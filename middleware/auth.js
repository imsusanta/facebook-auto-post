/**
 * API Authentication Middleware & Session Management
 * Enforces admin key authentication, session cookies, and fails closed in all environments
 * unless explicit development bypass is set.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const storage = require('../services/storage');
const { isOriginAllowed } = require('../utils/cors-validator');

// In-memory session store: Map<sessionId, { user, csrfToken, createdAt, expiresAt }>
const activeSessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ACTIVE_SESSIONS = 500; // Hardened session limit

// Periodic pruning of expired sessions
const sessionPruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of activeSessions.entries()) {
    if (s.expiresAt <= now) activeSessions.delete(id);
  }
}, 15 * 60 * 1000);
if (sessionPruneTimer.unref) sessionPruneTimer.unref();

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
 * PBKDF2 Password Hashing & Verification
 */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a valid string');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  if (!password || !hash || !salt || typeof password !== 'string') return false;
  try {
    const testHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    const testBuf = Buffer.from(testHash, 'utf8');
    const hashBuf = Buffer.from(hash, 'utf8');
    if (testBuf.length !== hashBuf.length) return false;
    return crypto.timingSafeEqual(testBuf, hashBuf);
  } catch {
    return false;
  }
}

/**
 * Check if the server has authentication configured
 * Either ADMIN_API_KEY environment variable OR stored adminPasswordHash
 */
function isAuthConfigured() {
  if (process.env.ADMIN_API_KEY && typeof process.env.ADMIN_API_KEY === 'string' && process.env.ADMIN_API_KEY.trim()) {
    return true;
  }
  try {
    const settings = storage.getSettings();
    if (settings && settings.adminPasswordHash && settings.adminPasswordSalt) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
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
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

/**
 * Session Store Management
 */
function createSession(user = null) {
  // Prune expired sessions
  const now = Date.now();
  for (const [id, s] of activeSessions.entries()) {
    if (s.expiresAt <= now) activeSessions.delete(id);
  }

  // Prune oldest session if capacity reached
  if (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
    const oldestSessionId = activeSessions.keys().next().value;
    if (oldestSessionId) {
      activeSessions.delete(oldestSessionId);
    }
  }

  const sessionId = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');

  activeSessions.set(sessionId, {
    user: user ? {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    } : null,
    csrfToken,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS
  });
  return sessionId;
}

function getSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  const session = activeSessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    activeSessions.delete(sessionId);
    return null;
  }
  return session;
}

function validateSession(sessionId) {
  return Boolean(getSession(sessionId));
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
  if (
    path === '/auth/login' ||
    path === '/auth/setup' ||
    path === '/auth/dev-login' ||
    path === '/auth/logout' ||
    path === '/auth/session' ||
    path === '/auth/status' ||
    originalUrl.startsWith('/api/auth/login') ||
    originalUrl.startsWith('/api/auth/setup') ||
    originalUrl.startsWith('/api/auth/dev-login') ||
    originalUrl.startsWith('/api/auth/logout') ||
    originalUrl.startsWith('/api/auth/session') ||
    originalUrl.startsWith('/api/auth/status')
  ) {
    return next();
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const devBypass = process.env.DEV_AUTH_BYPASS === 'true';

  // 4. Development Bypass Check (ONLY allowed when NODE_ENV !== 'production' AND DEV_AUTH_BYPASS === 'true')
  if (!isProduction && devBypass) {
    if (!bypassWarningLogged) {
      logger.warn('[SECURITY WARNING] Development authentication bypass is active via DEV_AUTH_BYPASS=true. Do NOT use in production.');
      bypassWarningLogged = true;
    }
    return next();
  }

  // 4b. Test Environment Identity Header (ONLY allowed when NODE_ENV === 'test')
  if (process.env.NODE_ENV === 'test' && req.headers['x-test-user-id']) {
    req.authType = 'test';
    req.user = {
      id: req.headers['x-test-user-id'],
      email: req.headers['x-test-user-email'] || 'test@example.com',
      role: 'user'
    };
    return next();
  }

  // 5. Check Session Cookie (authenticated browser sessions)
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.auth_session || cookies['__Host-auth_session'];
  const session = getSession(sessionId);
  if (session) {
    req.authType = 'cookie';
    req.session = session;
    req.user = session.user || {
      id: 'usr_superadmin',
      email: 'susantalohr@gmail.com',
      name: 'Susanta Lohar',
      role: 'super_admin'
    };

    // CSRF Protection for mutating endpoints when authenticated via browser cookie
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      // 1. Origin validation: If Origin or Referer header is present, it must be allowed
      const originHeader = req.headers.origin || req.headers.referer;
      if (originHeader) {
        let originDomain = originHeader;
        try {
          originDomain = new URL(originHeader).origin;
        } catch {
          // ignore parsing error
        }
        if (!isOriginAllowed(originDomain)) {
          logger.warn(`[Security] CSRF blocked: Untrusted request origin "${originHeader}"`);
          return res.status(403).json({
            success: false,
            error: 'Forbidden: Request origin is not allowed.',
            code: 'FORBIDDEN_ORIGIN'
          });
        }
      }

      // 2. CSRF Token verification
      const clientCsrfToken = req.headers['x-csrf-token'];
      const sessionCsrfToken = session.csrfToken;
      if (!clientCsrfToken || !sessionCsrfToken || !safeCompare(clientCsrfToken, sessionCsrfToken)) {
        logger.warn('[Security] CSRF blocked: Missing or invalid X-CSRF-Token header.');
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Invalid or missing CSRF token.',
          code: 'CSRF_TOKEN_INVALID'
        });
      }
    }

    return next();
  }

  // 6. Check Header Credentials (x-admin-key or Authorization: Bearer)
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

  const expectedKey = process.env.ADMIN_API_KEY;

  if (headerToken) {
    if (expectedKey && typeof expectedKey === 'string' && expectedKey.trim() && safeCompare(headerToken, expectedKey.trim())) {
      req.user = {
        id: 'usr_system',
        email: 'system@local',
        name: 'System Admin',
        role: 'super_admin'
      };
      return next();
    }
    try {
      const superAdmin = storage.findUserByEmail('susantalohr@gmail.com');
      if (superAdmin && verifyPassword(headerToken, superAdmin.passwordHash, superAdmin.passwordSalt)) {
        req.user = {
          id: superAdmin.id,
          email: superAdmin.email,
          name: superAdmin.name,
          role: superAdmin.role
        };
        return next();
      }
      const settings = storage.getSettings();
      if (settings && settings.adminPasswordHash && settings.adminPasswordSalt) {
        if (verifyPassword(headerToken, settings.adminPasswordHash, settings.adminPasswordSalt)) {
          req.user = {
            id: 'usr_admin',
            email: 'admin@local',
            name: 'Administrator',
            role: 'admin'
          };
          return next();
        }
      }
    } catch {
      // ignore
    }
  }

  // 7. Fail closed if authentication is not configured on server
  if (!isAuthConfigured()) {
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

  // 8. Reject Unauthorized Request (auth configured, but credentials missing or invalid)
  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Invalid or missing authentication credentials.',
    code: 'UNAUTHORIZED'
  });
}

/**
 * Role-based authorization middleware
 */
function requireRole(allowedRoles = ['admin', 'super_admin']) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
        code: 'UNAUTHORIZED'
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Insufficient role permissions.',
        code: 'FORBIDDEN_ROLE'
      });
    }
    return next();
  };
}

function stopSessionPruneTimer() {
  if (sessionPruneTimer) {
    clearInterval(sessionPruneTimer);
  }
}

module.exports = {
  authMiddleware,
  safeCompare,
  createSession,
  getSession,
  validateSession,
  destroySession,
  clearAllSessions,
  stopSessionPruneTimer,
  hasQueryCredentials,
  parseCookies,
  hashPassword,
  verifyPassword,
  isAuthConfigured,
  requireRole
};
