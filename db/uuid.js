'use strict';

const crypto = require('crypto');

let lastTimestamp = -1;
let seq = 0;

/**
 * Generates a RFC 9562 compliant UUIDv7 identifier.
 * Incorporates a 48-bit millisecond timestamp and 74 bits of entropy/monotonic sequence.
 * @returns {string} 36-character canonical UUID string
 */
function generateUuidV7() {
  let timestamp = Date.now();

  if (timestamp === lastTimestamp) {
    seq = (seq + 1) & 0x0fff; // 12-bit sequence counter
    if (seq === 0) {
      // Sequence exhausted in same millisecond, increment timestamp by 1ms
      timestamp = lastTimestamp + 1;
    }
  } else {
    lastTimestamp = timestamp;
    seq = crypto.randomInt(0, 0x0fff);
  }

  // 48 bits timestamp (6 bytes)
  const timeBytes = Buffer.alloc(6);
  timeBytes.writeUIntBE(timestamp, 0, 6);

  // 10 random bytes for rand_a and rand_b
  const randomBytes = crypto.randomBytes(10);

  // Combine into 16-byte buffer
  const buffer = Buffer.alloc(16);
  timeBytes.copy(buffer, 0, 0, 6);
  randomBytes.copy(buffer, 6, 0, 10);

  // Set version 7 (0111) in byte 6
  buffer[6] = 0x70 | ((seq >> 8) & 0x0f);
  buffer[7] = seq & 0xff;

  // Set variant RFC 4122 (10xx) in byte 8
  buffer[8] = 0x80 | (buffer[8] & 0x3f);

  // Format canonical UUID string
  const hex = buffer.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUIDV7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(id) {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}

function isUuidV7(id) {
  if (!id || typeof id !== 'string') return false;
  return UUIDV7_REGEX.test(id.trim());
}

module.exports = {
  generateUuidV7,
  isValidUuid,
  isUuidV7
};
