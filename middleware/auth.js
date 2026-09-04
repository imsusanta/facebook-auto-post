/**
 * API Authentication & Authorization Middleware
 * Verifies admin API key using constant-time comparison, fails closed in production,
 * and preserves webhook verification.
 */

const crypto = require('crypto');

/**
 * Constant-time comparison between two strings to mitigate timing attacks.
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function authMiddleware(req, res, next) {
  // Webhooks are verified via Meta challenge / HMAC, never block them
  if (req.path.startsWith('/webhook') || req.originalUrl.includes('/webhook')) {
    return next();
  }

  const expectedKey = process.env.ADMIN_API_KEY || process.env.AUTH_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  const devBypass = process.env.DEV_AUTH_BYPASS === 'true';

  // In production, fail closed if no key configured
  if (!expectedKey) {
    if (isProduction) {
      console.error('[Security] ADMIN_API_KEY is not configured in production. Failing closed.');
      return res.status(500).json({
        success: false,
        error: 'Server security misconfiguration: ADMIN_API_KEY must be configured in production.'
      });
    }

    // In development or test, allow bypass if explicitly set or if no key is configured
    if (devBypass || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || !process.env.NODE_ENV) {
      return next();
    }
  }

  // Extract token from x-admin-key, Authorization header, or query param (for SSE EventSource)
  const authHeader = req.headers['authorization'];
  const adminKeyHeader = req.headers['x-admin-key'];

  let token = adminKeyHeader;
  if (!token && authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && (parts[0].toLowerCase() === 'bearer' || parts[0].toLowerCase() === 'token')) {
      token = parts[1];
    } else {
      token = authHeader;
    }
  }

  if (!token && req.query) {
    token = req.query.apiKey || req.query.token || req.query.key;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing required authentication credentials.'
    });
  }

  if (safeCompare(token, expectedKey)) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Invalid credentials.'
  });
}

module.exports = {
  authMiddleware,
  safeCompare
};
