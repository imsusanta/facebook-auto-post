/**
 * Centralized SaaS Error Handling Middleware
 * Redacts secrets, tokens, and authorization headers from client error responses.
 * Never exposes raw internal error messages or stacks in production.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

function redactSensitiveString(str) {
  if (typeof str !== 'string') return str;
  let redacted = str
    .replace(/AIza[0-9A-Za-z_-]{25,}/g, '[REDACTED_API_KEY]')
    .replace(/EAA[0-9A-Za-z_-]{15,}/g, '[REDACTED_FB_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:access_token|key|apiKey|api_key|token|secret|password)=)([^&\s]+)/gi, '$1[REDACTED]')
    .replace(/(?:key|token|secret|password)=([^\s&]+)/gi, 'param=[REDACTED]');

  if (process.env.ADMIN_API_KEY && process.env.ADMIN_API_KEY.length > 5) {
    redacted = redacted.split(process.env.ADMIN_API_KEY).join('[REDACTED_ADMIN_KEY]');
  }

  return redacted;
}

function containsInternals(msg) {
  if (!msg || typeof msg !== 'string') return false;
  // Check for filesystem paths, stack keywords, DB queries, or provider internals
  if (/(\/Users\/|\/home\/|[A-Z]:\\|\bnode_modules\b|\bat\s+[A-Za-z0-9_.]+\s+\()/i.test(msg)) {
    return true;
  }
  if (/ADMIN_API_KEY|GEMINI_API_KEY|FB_PAGE_ACCESS_TOKEN/i.test(msg)) {
    return true;
  }
  return false;
}

function errorHandler(err, req, res, next) {
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const statusCode = err.statusCode || (res.statusCode !== 200 && res.statusCode ? res.statusCode : 500);
  const isProduction = process.env.NODE_ENV === 'production';
  const isDev = process.env.NODE_ENV === 'development';

  // Sanitized internal log including requestId
  const internalLogMsg = redactSensitiveString(err.stack || err.message || String(err));
  const safeReqUrl = redactSensitiveString(req.originalUrl || req.url || '');
  logger.error(`[Error ${requestId}] ${req.method} ${safeReqUrl}:`, internalLogMsg);

  let clientError = 'Request could not be completed.';
  let clientCode = err.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');

  if (statusCode < 500) {
    const rawMsg = err.message || '';
    if (!containsInternals(rawMsg)) {
      clientError = redactSensitiveString(rawMsg);
    } else {
      clientError = 'Validation failed with invalid parameters.';
    }
  } else {
    // 500+ errors
    if (!isProduction && isDev) {
      clientError = redactSensitiveString(err.message || 'Internal Server Error');
    } else {
      clientError = 'Request could not be completed.';
    }
  }

  const responsePayload = {
    success: false,
    error: clientError,
    code: clientCode,
    requestId
  };

  if (isDev && err.stack) {
    responsePayload.stack = redactSensitiveString(err.stack);
  }

  res.status(statusCode).json(responsePayload);
}

module.exports = errorHandler;
module.exports.redactSensitiveString = redactSensitiveString;
module.exports.containsInternals = containsInternals;
