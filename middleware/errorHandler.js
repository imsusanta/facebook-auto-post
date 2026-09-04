/**
 * Centralized SaaS Error Handling Middleware
 * Redacts secrets, tokens, and authorization headers from client error responses.
 */

function redactSensitiveString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/AIza[0-9A-Za-z_-]{25,}/g, '[REDACTED_API_KEY]')
    .replace(/EAA[0-9A-Za-z_-]{15,}/g, '[REDACTED_FB_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(?:key|token|secret|password)=([^\s&]+)/gi, '$1=[REDACTED]');
}

function errorHandler(err, req, res, next) {
  const safeMessage = redactSensitiveString(err.message || 'Internal Server Error');
  console.error(`[Error] ${req.method} ${req.originalUrl}:`, safeMessage);

  const statusCode = err.statusCode || (res.statusCode !== 200 && res.statusCode ? res.statusCode : 500);

  const isDev = process.env.NODE_ENV === 'development';
  res.status(statusCode).json({
    success: false,
    error: safeMessage,
    ...(isDev && err.stack && { stack: redactSensitiveString(err.stack) })
  });
}

module.exports = errorHandler;
