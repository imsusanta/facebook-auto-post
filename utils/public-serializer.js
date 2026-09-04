/**
 * Public Serializer Utility
 * Strips sensitive credentials, API keys, and tokens from objects before
 * sending responses via REST APIs, SSE broadcasts, or logging.
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
  'app_secret'
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
  if (compact.endsWith('token') || compact.endsWith('secret') || compact.endsWith('apikey') || compact.endsWith('password')) {
    return true;
  }
  return false;
}

/**
 * Mask a secret string, leaving at most visibleChars at the end
 */
function maskSecret(str, visibleChars = 4) {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= visibleChars) return '••••';
  return '••••••••' + str.slice(-visibleChars);
}

/**
 * Internal recursive serializer that avoids mutating input and handles circular references
 */
function deepSanitize(obj, seen = new WeakSet()) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Handle Date, RegExp, Error
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof RegExp) return new RegExp(obj);
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: obj.message
    };
  }

  // Circular reference check
  if (seen.has(obj)) {
    return '[Circular]';
  }
  seen.add(obj);

  // Array handling
  if (Array.isArray(obj)) {
    return obj.map(item => {
      const sanitized = deepSanitize(item, seen);
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        if ('accessToken' in item || 'access_token' in item) {
          sanitized.hasToken = !!(item.accessToken || item.access_token);
          sanitized.connected = !!(item.accessToken || item.access_token);
        }
      }
      return sanitized;
    });
  }

  // Object handling
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      continue; // Strip sensitive key
    }
    result[key] = deepSanitize(val, seen);
  }

  // Enrich with safe status booleans if source contained credentials
  if ('geminiApiKey' in obj || 'gemini_api_key' in obj) {
    const keyVal = obj.geminiApiKey || obj.gemini_api_key;
    result.geminiConfigured = typeof keyVal === 'string' && keyVal.trim().length > 0;
  }
  if ('accessToken' in obj || 'access_token' in obj) {
    const tokenVal = obj.accessToken || obj.access_token;
    result.hasToken = typeof tokenVal === 'string' && tokenVal.trim().length > 0;
    result.connected = result.hasToken;
  }
  if (Array.isArray(obj.pages)) {
    result.facebookConnected = !!(
      (obj.accessToken && obj.accessToken.trim().length > 0) ||
      obj.pages.some(p => p && (p.accessToken || p.access_token))
    );
  } else if ('accessToken' in obj) {
    result.facebookConnected = !!(obj.accessToken && obj.accessToken.trim().length > 0);
  }

  return result;
}

/**
 * Public serializer for any data structure
 */
function serializePublic(data) {
  return deepSanitize(data);
}

/**
 * Specialized serializer for settings payload
 */
function serializeSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const sanitized = deepSanitize(settings);
  sanitized.geminiConfigured = typeof settings.geminiApiKey === 'string' && settings.geminiApiKey.trim().length > 0;
  sanitized.facebookConnected = !!(
    (settings.accessToken && settings.accessToken.trim().length > 0) ||
    (Array.isArray(settings.pages) && settings.pages.some(p => p && p.accessToken))
  );
  return sanitized;
}

/**
 * Specialized serializer for a single Facebook Page object
 */
function serializePage(page) {
  if (!page || typeof page !== 'object') return page;
  const sanitized = deepSanitize(page);
  sanitized.hasToken = typeof page.accessToken === 'string' && page.accessToken.trim().length > 0;
  sanitized.connected = sanitized.hasToken;
  return sanitized;
}

/**
 * Specialized serializer for an array of Facebook Page objects
 */
function serializePages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.map(serializePage);
}

module.exports = {
  isSensitiveKey,
  maskSecret,
  serializePublic,
  serializeSettings,
  serializePage,
  serializePages
};
