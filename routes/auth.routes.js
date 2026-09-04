/**
 * Authentication Routes
 * Provides SaaS email/password login, setup, logout, and session endpoints using HttpOnly cookies.
 */

const express = require('express');
const router = express.Router();
const storage = require('../services/storage');
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

// Helper to set session cookie
function setAuthCookie(res, sessionId) {
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  const cookieHeader = `auth_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=86400`;
  res.setHeader('Set-Cookie', cookieHeader);
}

// POST /api/auth/login - Authenticate with email/password or admin key and set session cookie
router.post('/login', (req, res) => {
  const { email, password, key } = req.body || {};

  // 1. Primary SaaS Flow: Email & Password
  if (typeof email === 'string' && email.trim()) {
    const cleanEmail = email.toLowerCase().trim();
    const candidatePassword = typeof password === 'string' ? password.trim() : '';

    if (!candidatePassword) {
      return res.status(400).json({
        success: false,
        error: 'Password is required.',
        code: 'PASSWORD_REQUIRED'
      });
    }

    const user = storage.findUserByEmail(cleanEmail);
    if (!user || !user.passwordHash || !user.passwordSalt) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
        code: 'INVALID_CREDENTIALS'
      });
    }

    if (!verifyPassword(candidatePassword, user.passwordHash, user.passwordSalt)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const sessionId = createSession({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    });
    setAuthCookie(res, sessionId);

    return res.json({
      success: true,
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  }

  // 2. Fallback / Admin Key Flow
  const candidate = typeof password === 'string' && password.trim()
    ? password.trim()
    : (typeof key === 'string' ? key.trim() : '');

  if (!candidate) {
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
      const sessionId = createSession({
        id: 'usr_superadmin',
        email: 'susantalohr@gmail.com',
        name: 'Susanta Lohar',
        role: 'super_admin'
      });
      setAuthCookie(res, sessionId);
      return res.json({
        success: true,
        authenticated: true,
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
    const sessionId = createSession({
      id: defaultAdmin.id,
      email: defaultAdmin.email,
      name: defaultAdmin.name,
      role: defaultAdmin.role
    });
    setAuthCookie(res, sessionId);
    return res.json({
      success: true,
      authenticated: true,
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
    const sessionId = createSession({
      id: 'usr_admin',
      email: 'admin@local',
      name: 'Administrator',
      role: 'admin'
    });
    setAuthCookie(res, sessionId);
    return res.json({
      success: true,
      authenticated: true,
      user: {
        id: 'usr_admin',
        email: 'admin@local',
        name: 'Administrator',
        role: 'admin'
      }
    });
  }

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

  const sessionId = createSession({
    id: 'usr_superadmin',
    email: 'susantalohr@gmail.com',
    name: 'Susanta Lohar',
    role: 'super_admin'
  });
  setAuthCookie(res, sessionId);

  return res.json({
    success: true,
    authenticated: true,
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

  return res.json({
    success: true,
    authenticated: true,
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

  res.setHeader('Set-Cookie', 'auth_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
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
    setupRequired: false,
    isDev: !isProduction
  });
});

module.exports = router;
