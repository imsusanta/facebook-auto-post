/**
 * Public Serializer Utility
 * Strips sensitive credentials, API keys, and tokens from objects before
 * sending responses via REST APIs, SSE broadcasts, or logging.
 *
 * Edge cases handled:
 * - Shared references are preserved (only actual recursion cycles marked [Circular])
 * - Buffer values are omitted
 * - Error messages are sanitized
 * - Map and Set instances are safely converted without leaks
 * - Secrets are completely removed
 * - Business booleans are applied ONLY in specialized serializers
 */

const SENSITIVE_KEY_NAMES = new Set([
  'accesstoken',
  'access_token',
  'pageaccesstoken',
  'page_access_token',
  'geminiapikey',
  'gemini_api_key',
  'apikey',
  'api_key',
  'token',
  'secret',
  'jwtsecret',
  'jwt_secret',
  'verifytoken',
  'verify_token',
  'authorization',
  'password',
  'refreshtoken',
  'refresh_token',
  'privatekey',
  'private_key',
  'fbappsecret',
  'appsecret',
  'app_secret',
  'credential',
  'credentials',
  'adminkey',
  'admin_key'
]);

/**
 * Check if a key name represents a sensitive credential
 */
function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  const lower = key.toLowerCase();
  if (SENSITIVE_KEY_NAMES.has(lower)) return true;
  const compact = lower.replace(/[-_]/g, '');
  if (SENSITIVE_KEY_NAMES.has(compact)) return true;
  if (
    compact.endsWith('token') ||
    compact.endsWith('secret') ||
    compact.endsWith('apikey') ||
    compact.endsWith('password') ||
    compact.endsWith('privatekey')
  ) {
    return true;
  }
  return false;
}

/**
 * Redact sensitive substrings in text
 */
function redactString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/AIza[0-9A-Za-z_-]{25,}/g, '[REDACTED_API_KEY]')
    .replace(/EAA[0-9A-Za-z_-]{15,}/g, '[REDACTED_FB_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:access_token|key|apiKey|api_key|token|secret|password)=)([^&\s]+)/gi, '$1[REDACTED]');
}

/**
 * Internal recursive serializer that avoids mutating input.
 * Uses an active ancestor stack (Set) so that shared object references (DAG)
 * are NOT falsely marked circular.
 */
function deepSanitize(obj, ancestorStack = new Set()) {
  if (obj === null || typeof obj !== 'object') {
    return typeof obj === 'string' ? redactString(obj) : obj;
  }

  // Never serialize Buffer instances to client responses
  if (Buffer.isBuffer(obj)) {
    return undefined;
  }

  // Handle Date, RegExp, Error
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof RegExp) return new RegExp(obj);
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: redactString(obj.message)
    };
  }

  // Handle Set: sanitize elements and convert to Array
  if (obj instanceof Set) {
    if (ancestorStack.has(obj)) return '[Circular]';
    ancestorStack.add(obj);
    const result = [];
    for (const item of obj) {
      const sanitized = deepSanitize(item, ancestorStack);
      if (sanitized !== undefined) result.push(sanitized);
    }
    ancestorStack.delete(obj);
    return result;
  }

  // Handle Map: convert to sanitized plain object
  if (obj instanceof Map) {
    if (ancestorStack.has(obj)) return '[Circular]';
    ancestorStack.add(obj);
    const result = {};
    for (const [k, v] of obj.entries()) {
      if (typeof k === 'string' && isSensitiveKey(k)) continue;
      const sanitizedVal = deepSanitize(v, ancestorStack);
      if (sanitizedVal !== undefined) {
        result[String(k)] = sanitizedVal;
      }
    }
    ancestorStack.delete(obj);
    return result;
  }

  // Circular reference detection (only true cycles in active call hierarchy)
  if (ancestorStack.has(obj)) {
    return '[Circular]';
  }
  ancestorStack.add(obj);

  // Array handling
  if (Array.isArray(obj)) {
    const result = [];
    for (const item of obj) {
      const sanitized = deepSanitize(item, ancestorStack);
      result.push(sanitized === undefined ? null : sanitized);
    }
    ancestorStack.delete(obj);
    return result;
  }

  // Plain Object handling
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      continue; // Strip sensitive key entirely
    }
    const sanitized = deepSanitize(val, ancestorStack);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }

  ancestorStack.delete(obj);
  return result;
}

/**
 * Generic public serializer for arbitrary data structures.
 * Does NOT infer business domain booleans.
 */
function serializePublic(data) {
  return deepSanitize(data);
}

/**
 * Specialized serializer for settings payload.
 * Adds domain booleans: geminiConfigured, facebookConnected.
 */
function serializeSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const sanitized = deepSanitize(settings);
  sanitized.geminiConfigured = typeof settings.geminiApiKey === 'string' && settings.geminiApiKey.trim().length > 0;
  sanitized.facebookConnected = !!(
    (settings.accessToken && settings.accessToken.trim().length > 0) ||
    (Array.isArray(settings.pages) && settings.pages.some(p => p && (p.accessToken || p.access_token)))
  );
  if (Array.isArray(settings.pages)) {
    sanitized.pages = serializePages(settings.pages);
  }
  return sanitized;
}

/**
 * Specialized serializer for a single Facebook Page object.
 * Adds domain booleans: hasToken, connected.
 */
function serializePage(page) {
  if (!page || typeof page !== 'object') return page;
  const sanitized = deepSanitize(page);
  sanitized.hasToken = typeof page.accessToken === 'string' && page.accessToken.trim().length > 0;
  sanitized.connected = sanitized.hasToken;
  return sanitized;
}

/**
 * Specialized serializer for an array of Facebook Page objects.
 */
function serializePages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.map(serializePage);
}

module.exports = {
  isSensitiveKey,
  redactString,
  deepSanitize,
  serializePublic,
  serializeSettings,
  serializePage,
  serializePages
};
