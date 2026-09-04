/**
 * Safe Application Logger
 * Intercepts log arguments, redacting API keys, access tokens, and sensitive headers.
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
  'private_key'
]);

/**
 * Redact sensitive substrings from text
 */
function redactString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/AIza[0-9A-Za-z_-]{25,}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/EAA[0-9A-Za-z_-]{15,}/g, '[REDACTED_FB_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:access_token|key|apiKey|api_key|secret)=)([^&\s]+)/gi, '$1[REDACTED]');
}

/**
 * Deeply redact sensitive fields from objects or arrays
 */
function redactObject(item, seen = new WeakSet()) {
  if (item === null || typeof item !== 'object') {
    return typeof item === 'string' ? redactString(item) : item;
  }

  if (item instanceof Date) return item;
  if (item instanceof RegExp) return item;
  if (item instanceof Error) {
    return {
      name: item.name,
      message: redactString(item.message),
      stack: redactString(item.stack)
    };
  }

  if (seen.has(item)) return '[Circular]';
  seen.add(item);

  if (Array.isArray(item)) {
    return item.map(el => redactObject(el, seen));
  }

  const result = {};
  for (const [k, v] of Object.entries(item)) {
    const lowerKey = k.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEY_NAMES.has(k.toLowerCase()) || SENSITIVE_KEY_NAMES.has(lowerKey)) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = redactObject(v, seen);
    }
  }
  return result;
}

/**
 * Redact an array of arguments passed to a log function
 */
function redactArgs(args) {
  return args.map(arg => {
    if (typeof arg === 'string') return redactString(arg);
    if (typeof arg === 'object' && arg !== null) return redactObject(arg);
    return arg;
  });
}

const logger = {
  info(...args) {
    console.log(...redactArgs(args));
  },
  warn(...args) {
    console.warn(...redactArgs(args));
  },
  error(...args) {
    console.error(...redactArgs(args));
  },
  debug(...args) {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.log('[DEBUG]', ...redactArgs(args));
    }
  },
  redactString,
  redactObject
};

module.exports = logger;
