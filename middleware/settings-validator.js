/**
 * Settings Validation Middleware
 * Enforces strict allowlist, prevents prototype pollution, validates field types/lengths,
 * rejects secrets from general settings, and validates cron schedules using node-cron.
 */

const cron = require('node-cron');

// Non-secret settings allowlist for general configuration
const ALLOWED_SETTINGS_KEYS = new Set([
  'pageName',
  'pageId',
  'autoPostEnabled',
  'autoPilotEnabled',
  'fallbackAutoPublishEnabled',
  'cronSchedule',
  'cronLabel',
  'selectedCategories',
  'includeAiImage',
  'intervalMinutes',
  'customSystemPrompt',
  'isDemoMode',
  'pictureUrl',
  'activePageId'
]);

// Explicitly forbidden secret fields in general settings
const FORBIDDEN_SECRET_KEYS = new Set([
  'accesstoken',
  'access_token',
  'pageaccesstoken',
  'page_access_token',
  'geminiapikey',
  'gemini_api_key',
  'webhookverifytoken',
  'webhook_verify_token',
  'verifytoken',
  'verify_token',
  'password',
  'secret',
  'token',
  'apikey',
  'api_key'
]);

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

  // 2. Reject any secret field attempts in general settings
  const payloadKeys = Object.keys(payload);
  const secretKeyAttempt = payloadKeys.find(k => {
    const lower = k.toLowerCase().replace(/[-_]/g, '');
    return FORBIDDEN_SECRET_KEYS.has(k.toLowerCase()) || FORBIDDEN_SECRET_KEYS.has(lower);
  });
  if (secretKeyAttempt) {
    return {
      valid: false,
      error: `Secret field "${secretKeyAttempt}" is forbidden in general settings. Use dedicated credential endpoints.`
    };
  }

  // 3. Allowlist Check
  const unknownKeys = payloadKeys.filter(k => !ALLOWED_SETTINGS_KEYS.has(k));
  if (unknownKeys.length > 0) {
    return { valid: false, error: `Disallowed or unexpected settings fields: ${unknownKeys.join(', ')}` };
  }

  // 4. Type and Range Checks
  if ('intervalMinutes' in payload) {
    const num = Number(payload.intervalMinutes);
    if (!Number.isInteger(num) || num < 1 || num > 1440) {
      return { valid: false, error: 'intervalMinutes must be an integer between 1 and 1440.' };
    }
  }

  if ('cronSchedule' in payload) {
    if (typeof payload.cronSchedule !== 'string' || !cron.validate(payload.cronSchedule.trim())) {
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

  const booleanFields = ['autoPostEnabled', 'autoPilotEnabled', 'fallbackAutoPublishEnabled', 'includeAiImage', 'isDemoMode'];
  for (const field of booleanFields) {
    if (field in payload && typeof payload[field] !== 'boolean') {
      return { valid: false, error: `${field} must be a boolean.` };
    }
  }

  const stringLengthLimits = {
    pageName: 200,
    pageId: 100,
    cronLabel: 200,
    customSystemPrompt: 10000,
    pictureUrl: 2000,
    activePageId: 100
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
      error: result.error,
      code: 'INVALID_SETTINGS_PAYLOAD'
    });
  }
  next();
}

module.exports = {
  validateSettings,
  validateSettingsPayload,
  ALLOWED_SETTINGS_KEYS,
  FORBIDDEN_SECRET_KEYS
};
