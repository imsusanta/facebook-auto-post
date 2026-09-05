'use strict';
const logger = require('./logger');
const DB_CODES = new Set(['23505', '23503', '23514', '40001', '40P01', '57014', '08006', 'ECONNREFUSED', 'ETIMEDOUT']);
// Error messages/details/stacks may contain arbitrary bound values or credentials.
// Retain fixed operation, server request ID and allowlisted failure category only.
module.exports = function safeDiagnostics(operation, err, requestId = null) {
  logger.error({ operation, requestId, category: DB_CODES.has(err?.code) ? err.code : 'UNEXPECTED_ERROR' });
};
