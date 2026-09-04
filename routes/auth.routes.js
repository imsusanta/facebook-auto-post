/**
 * Authentication Routes
 * Provides SaaS email/password login, setup, logout, and session endpoints
 * with rate limiting, HttpOnly cookies, and CSRF token distribution.
 */

const express = require('express');
const router = express.Router();
const storage = require('../services/storage');
const { isOriginAllowed } = require('../utils/cors-validator');
const {
  safeCompare,
  createSession,
  getSession,
  destroySession,
  parseCookies,
  hashPassword,
  verifyPassword,
  isAuthConfigured
} = require('../middleware/auth');

// Failed login attempt tracking for IP rate-limiting
const failedLoginAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = failedLoginAttempts.get(ip) || { count: 0, resetTime: now + LOCKOUT_MS };
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + LOCKOUT_MS;
  } else {
    record.count += 1;
  }
  failedLoginAttempts.set(ip, record);
}

function isIpLockedOut(ip) {
  const record = failedLoginAttempts.get(ip);
  if (!record) return false;
  if (Date.now() > record.resetTime) {
    failedLoginAttempts.delete(ip);
    return false;
  }
  return record.count >= MAX_FAILED_ATTEMPTS;
}

function resetFailedLogins(ip) {
  if (ip) {
    failedLoginAttempts.delete(ip);
  } else {
    failedLoginAttempts.clear();
  }
}

// Helper to set session cookie
function setAuthCookie(res, sessionId) {
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  const cookieHeader = `auth_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict${secureFlag}; Max-Age=86400`;
  res.setHeader('Set-Cookie', cookieHeader);
}

// Session rotation helper: destroys previous session before issuing new credentials
function rotateSession(req, res, userData) {
  const existingCookies = parseCookies(req.headers.cookie);
  if (existingCookies.auth_session) {
    destroySession(existingCookies.auth_session);
  }
  const sessionId = createSession(userData);
  setAuthCookie(res, sessionId);
  return sessionId;
}

// POST /api/auth/login - Authenticate with email/password or admin key and set session cookie
router.post('/login', (req, res) => {
  const clientIp = req.ip || req.connection?.remoteAddress || '127.0.0.1';

  // 1. Enforce strict rate limit on failed login attempts
  if (isIpLockedOut(clientIp)) {
    return res.status(429).json({
      success: false,
      error: 'Too many failed login attempts. Please try again in 15 minutes.',
      code: 'TOO_MANY_FAILED_LOGINS'
    });
  }

  // 2. Strict Origin check if Origin header was supplied by browser
  const origin = req.headers.origin;
  if (origin) {
    let originHost = origin;
    try {
      originHost = new URL(origin).origin;
    } catch {
      // ignore
    }
    if (!isOriginAllowed(originHost)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Request origin is not allowed.',
        code: 'FORBIDDEN_ORIGIN'
      });
    }
  }

  const { email, password, key } = req.body || {};

  // 3. Primary SaaS Flow: Email & Password
  if (typeof email === 'string' && email.trim()) {
    const cleanEmail = email.toLowerCase().trim();
    const candidatePassword = typeof password === 'string' ? password.trim() : '';

    if (!candidatePassword) {
      recordFailedLogin(clientIp);
      return res.status(400).json({
        success: false,
        error: 'Password is required.',
        code: 'PASSWORD_REQUIRED'
      });
    }

    const user = storage.findUserByEmail(cleanEmail);
    if (!user || !user.passwordHash || !user.passwordSalt) {
      recordFailedLogin(clientIp);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
        code: 'INVALID_CREDENTIALS'
      });
    }

    if (!verifyPassword(candidatePassword, user.passwordHash, user.passwordSalt)) {
      recordFailedLogin(clientIp);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
        code: 'INVALID_CREDENTIALS'
      });
    }

    resetFailedLogins(clientIp);
    const sessionId = rotateSession(req, res, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    });
    const session = getSession(sessionId);

    return res.json({
      success: true,
      authenticated: true,
      csrfToken: session?.csrfToken || null,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  }

  // 4. Fallback / Admin Key Flow
  const candidate = typeof password === 'string' && password.trim()
    ? password.trim()
    : (typeof key === 'string' ? key.trim() : '');

  if (!candidate) {
    recordFailedLogin(clientIp);
    return res.status(400).json({
      success: false,
      error: 'Please enter your email and password.',
      code: 'CREDENTIAL_REQUIRED'
    });
  }

  // Check ADMIN_API_KEY environment variable
  const expectedEnvKey = process.env.ADMIN_API_KEY;
  if (expectedEnvKey && typeof expectedEnvKey === 'string' && expectedEnvKey.trim()) {
    if (safeCompare(candidate, expectedEnvKey.trim())) {
      resetFailedLogins(clientIp);
      const sessionId = rotateSession(req, res, {
        id: 'usr_superadmin',
        email: 'susantalohr@gmail.com',
        name: 'Susanta Lohar',
        role: 'super_admin'
      });
      const session = getSession(sessionId);
      return res.json({
        success: true,
        authenticated: true,
        csrfToken: session?.csrfToken || null,
        user: {
          id: 'usr_superadmin',
          email: 'susantalohr@gmail.com',
          name: 'Susanta Lohar',
          role: 'super_admin'
        }
      });
    }
  }

  // Check super admin password
  const defaultAdmin = storage.findUserByEmail('susantalohr@gmail.com');
  if (defaultAdmin && verifyPassword(candidate, defaultAdmin.passwordHash, defaultAdmin.passwordSalt)) {
    resetFailedLogins(clientIp);
    const sessionId = rotateSession(req, res, {
      id: defaultAdmin.id,
      email: defaultAdmin.email,
      name: defaultAdmin.name,
      role: defaultAdmin.role
    });
    const session = getSession(sessionId);
    return res.json({
      success: true,
      authenticated: true,
      csrfToken: session?.csrfToken || null,
      user: {
        id: defaultAdmin.id,
        email: defaultAdmin.email,
        name: defaultAdmin.name,
        role: defaultAdmin.role
      }
    });
  }

  // Check stored settings password if any
  const adminAuth = storage.getAdminAuth();
  if (adminAuth.hasPassword && verifyPassword(candidate, adminAuth.hash, adminAuth.salt)) {
    resetFailedLogins(clientIp);
    const sessionId = rotateSession(req, res, {
      id: 'usr_admin',
      email: 'admin@local',
      name: 'Administrator',
      role: 'admin'
    });
    const session = getSession(sessionId);
    return res.json({
      success: true,
      authenticated: true,
      csrfToken: session?.csrfToken || null,
      user: {
        id: 'usr_admin',
        email: 'admin@local',
        name: 'Administrator',
        role: 'admin'
      }
    });
  }

  recordFailedLogin(clientIp);
  if (!isAuthConfigured()) {
    return res.status(400).json({
      success: false,
      error: 'Authentication is not configured yet. Please complete initial setup.',
      code: 'AUTH_CONFIG_MISSING',
      setupRequired: true
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Invalid credentials.',
    code: 'INVALID_CREDENTIALS'
  });
});

// POST /api/auth/setup - First-time admin password setup
router.post('/setup', (req, res) => {
  const { password } = req.body || {};

  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 8 characters long.',
      code: 'PASSWORD_TOO_SHORT'
    });
  }

  const existingAuth = storage.getAdminAuth();
  if (existingAuth.hasPassword) {
    return res.status(400).json({
      success: false,
      error: 'Admin password is already configured. Use settings or login instead.',
      code: 'ALREADY_CONFIGURED'
    });
  }

  const { hash, salt } = hashPassword(password);
  storage.saveAdminAuth(hash, salt);

  const sessionId = rotateSession(req, res, {
    id: 'usr_superadmin',
    email: 'susantalohr@gmail.com',
    name: 'Susanta Lohar',
    role: 'super_admin'
  });
  const session = getSession(sessionId);

  return res.json({
    success: true,
    authenticated: true,
    csrfToken: session?.csrfToken || null,
    user: {
      id: 'usr_superadmin',
      email: 'susantalohr@gmail.com',
      name: 'Susanta Lohar',
      role: 'super_admin'
    },
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

  const defaultAdmin = storage.findUserByEmail('susantalohr@gmail.com');
  const user = defaultAdmin || {
    id: 'usr_superadmin',
    email: 'susantalohr@gmail.com',
    name: 'Susanta Lohar',
    role: 'super_admin'
  };

  const sessionId = createSession(user);
  setAuthCookie(res, sessionId);
  const session = getSession(sessionId);

  return res.json({
    success: true,
    authenticated: true,
    csrfToken: session?.csrfToken || null,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
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

  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  res.setHeader('Set-Cookie', `auth_session=; Path=/; HttpOnly; SameSite=Strict${secureFlag}; Max-Age=0`);
  return res.json({
    success: true,
    authenticated: false
  });
});

// GET /api/auth/session - Check authentication state and return user profile
router.get('/session', (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const devBypass = !isProduction && process.env.DEV_AUTH_BYPASS === 'true';

  if (devBypass) {
    return res.json({
      success: true,
      authenticated: true,
      bypass: true,
      csrfToken: 'dev_bypass_csrf_token',
      user: {
        id: 'usr_superadmin',
        email: 'susantalohr@gmail.com',
        name: 'Susanta Lohar',
        role: 'super_admin'
      },
      isDev: true
    });
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.auth_session;
  const session = getSession(sessionId);

  if (session) {
    return res.json({
      success: true,
      authenticated: true,
      bypass: false,
      csrfToken: session.csrfToken || null,
      user: session.user || {
        id: 'usr_superadmin',
        email: 'susantalohr@gmail.com',
        name: 'Susanta Lohar',
        role: 'super_admin'
      },
      isDev: !isProduction
    });
  }

  return res.json({
    success: true,
    authenticated: false,
    bypass: false,
    user: null,
    isDev: !isProduction
  });
});

// GET /api/auth/status - Public check if authentication is configured
router.get('/status', (req, res) => {
  const configured = isAuthConfigured();
  return res.json({
    success: true,
    configured,
    mode: configured ? 'protected' : 'setup_required'
  });
});

module.exports = router;
module.exports.resetFailedLogins = resetFailedLogins;
