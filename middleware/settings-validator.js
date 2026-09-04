/**
 * Settings Validation Middleware
 * Enforces strict allowlist, prevents prototype pollution, and validates field types/lengths.
 */

const ALLOWED_SETTINGS_KEYS = new Set([
  'pageName',
  'pageId',
  'accessToken',
  'geminiApiKey',
  'autoPostEnabled',
  'autoPilotEnabled',
  'cronSchedule',
  'cronLabel',
  'selectedCategories',
  'includeAiImage',
  'intervalMinutes',
  'customSystemPrompt',
  'isDemoMode',
  'pictureUrl',
  'activePageId',
  'webhookVerifyToken'
]);

// Basic 5-part cron syntax regex (supports standard values, ranges, steps, lists, wildcards)
const CRON_REGEX = /^(\*|[0-9,\-\*\/]+)\s+(\*|[0-9,\-\*\/]+)\s+(\*|[0-9,\-\*\/]+)\s+(\*|[0-9,\-\*\/]+)\s+(\*|[0-9,\-\*\/]+)$/;

/**
 * Check recursively for prototype pollution keys
 */
function hasPrototypePollution(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (hasPrototypePollution(obj[key])) return true;
    }
  }
  return false;
}

/**
 * Validate settings payload
 */
function validateSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Request body must be a valid JSON object.' };
  }

  // 1. Prototype Pollution Check
  if (hasPrototypePollution(payload)) {
    return { valid: false, error: 'Prototype pollution detected in request body.' };
  }

  // 2. Allowlist Check
  const unknownKeys = Object.keys(payload).filter(k => !ALLOWED_SETTINGS_KEYS.has(k));
  if (unknownKeys.length > 0) {
    return { valid: false, error: `Disallowed or unexpected settings fields: ${unknownKeys.join(', ')}` };
  }

  // 3. Type and Range Checks
  if ('intervalMinutes' in payload) {
    const num = Number(payload.intervalMinutes);
    if (!Number.isInteger(num) || num < 1 || num > 1440) {
      return { valid: false, error: 'intervalMinutes must be an integer between 1 and 1440.' };
    }
  }

  if ('cronSchedule' in payload) {
    if (typeof payload.cronSchedule !== 'string' || !CRON_REGEX.test(payload.cronSchedule.trim())) {
      return { valid: false, error: 'cronSchedule must be a valid 5-part cron expression (e.g. "0 9,14,20 * * *").' };
    }
  }

  if ('selectedCategories' in payload) {
    if (!Array.isArray(payload.selectedCategories)) {
      return { valid: false, error: 'selectedCategories must be an array of category strings.' };
    }
    for (const cat of payload.selectedCategories) {
      if (typeof cat !== 'string' || cat.length > 100) {
        return { valid: false, error: 'Each selected category must be a string up to 100 characters.' };
      }
    }
  }

  const booleanFields = ['autoPostEnabled', 'autoPilotEnabled', 'includeAiImage', 'isDemoMode'];
  for (const field of booleanFields) {
    if (field in payload && typeof payload[field] !== 'boolean') {
      return { valid: false, error: `${field} must be a boolean.` };
    }
  }

  const stringLengthLimits = {
    pageName: 200,
    pageId: 100,
    accessToken: 1000,
    geminiApiKey: 300,
    cronLabel: 200,
    customSystemPrompt: 10000,
    pictureUrl: 2000,
    activePageId: 100,
    webhookVerifyToken: 200
  };

  for (const [field, maxLen] of Object.entries(stringLengthLimits)) {
    if (field in payload) {
      if (typeof payload[field] !== 'string') {
        return { valid: false, error: `${field} must be a string.` };
      }
      if (payload[field].length > maxLen) {
        return { valid: false, error: `${field} exceeds maximum length of ${maxLen} characters.` };
      }
    }
  }

  return { valid: true };
}

/**
 * Express middleware for settings validation
 */
function validateSettings(req, res, next) {
  const result = validateSettingsPayload(req.body);
  if (!result.valid) {
    return res.status(400).json({
      success: false,
      error: result.error
    });
  }
  next();
}

module.exports = {
  validateSettings,
  validateSettingsPayload,
  ALLOWED_SETTINGS_KEYS
};
