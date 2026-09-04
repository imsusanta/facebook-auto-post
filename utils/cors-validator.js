/**
 * CORS Origin Validator
 * Enforces strict origin allowlists, rejects malformed entries,
 * restricts localhost to development mode, and fails closed in production.
 */

/**
 * Check if a URL string is a valid, well-formed HTTP/HTTPS origin
 */
function isValidOriginFormat(origin) {
  if (typeof origin !== 'string' || !origin.trim()) return false;
  try {
    const parsed = new URL(origin.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.pathname.replace('/', '') && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

/**
 * Parse configured allowed origins from environment
 */
function getAllowedOrigins() {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDev = process.env.NODE_ENV === 'development';
  const raw = process.env.ALLOWED_ORIGINS;

  if (typeof raw === 'string' && raw.trim().length > 0) {
    const list = raw.split(',').map(o => o.trim()).filter(Boolean);
    const validList = list.filter(isValidOriginFormat);
    return validList;
  }

  // If in development mode and nothing is set, default to localhost
  if (isDev) {
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  }

  // In production with no configured origins, fail closed: empty list
  return [];
}

/**
 * Check whether an inbound origin is permitted
 */
function isOriginAllowed(origin) {
  if (!origin || typeof origin !== 'string') return false;
  const isDev = process.env.NODE_ENV === 'development';
  const allowed = getAllowedOrigins();

  const trimmed = origin.trim();

  // Exact match from allowed list
  if (allowed.includes(trimmed)) {
    return true;
  }

  // Development mode only: allow localhost on any port
  if (isDev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(trimmed)) {
    return true;
  }

  return false;
}

module.exports = {
  isValidOriginFormat,
  getAllowedOrigins,
  isOriginAllowed
};
