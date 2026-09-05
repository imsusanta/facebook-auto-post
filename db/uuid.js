'use strict';

const crypto = require('crypto');

/**
 * Generates a cryptographically secure random UUID (RFC 4122 UUIDv4).
 * Uses Node.js built-in CSPRNG without custom monotonic counter state,
 * eliminating clock rollback and sequence wrap vulnerabilities.
 * @returns {string} 36-character canonical UUID string
 */
function generateUuid() {
  return crypto.randomUUID();
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(id) {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}

module.exports = {
  generateUuid,
  generateUuidV7: generateUuid, // Backward-compatible alias for existing callers
  isValidUuid
};
