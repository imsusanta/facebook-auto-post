'use strict';

const crypto = require('crypto');

let cachedKey = null;

/**
 * Returns the 32-byte encryption key from FB_TOKEN_ENCRYPTION_KEY env var.
 * Validates format (64-char lowercase hex) and caches the buffer.
 * @returns {Buffer}
 */
function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.FB_TOKEN_ENCRYPTION_KEY;
  if (!raw || typeof raw !== 'string') {
    throw new Error('FB_TOKEN_ENCRYPTION_KEY is not configured');
  }
  if (!/^[a-f0-9]{64}$/.test(raw)) {
    throw new Error('FB_TOKEN_ENCRYPTION_KEY must be exactly 64 lowercase hex characters (32 bytes)');
  }
  cachedKey = Buffer.from(raw, 'hex');
  return cachedKey;
}

/**
 * Encrypts plaintext using AES-256-GCM with Additional Authenticated Data.
 * AAD should be a unique identifier bound to the row (e.g. workspace_page_id UUID).
 *
 * @param {string} plaintext - The sensitive value to encrypt
 * @param {string} aad - Additional authenticated data (prevents ciphertext relocation)
 * @returns {string} JSON envelope: { v, iv, tag, body }
 */
function encrypt(plaintext, aad) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Plaintext is required for encryption');
  }
  if (!aad || typeof aad !== 'string') {
    throw new Error('AAD (additional authenticated data) is required');
  }

  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  return JSON.stringify({
    v: 1,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    body: ciphertext.toString('hex')
  });
}

/**
 * Decrypts an AES-256-GCM envelope with AAD verification.
 *
 * @param {string} envelope - JSON string from encrypt()
 * @param {string} aad - Must match the AAD used during encryption
 * @returns {string} Decrypted plaintext
 */
function decrypt(envelope, aad) {
  if (!envelope || typeof envelope !== 'string') {
    throw new Error('Encrypted envelope is required for decryption');
  }
  if (!aad || typeof aad !== 'string') {
    throw new Error('AAD (additional authenticated data) is required');
  }

  const key = getKey();
  let data;
  try {
    data = JSON.parse(envelope);
  } catch {
    throw new Error('Malformed encrypted envelope');
  }

  if (data.v !== 1) {
    throw new Error('Unsupported token vault envelope version');
  }
  if (!data.iv || !data.tag || !data.body) {
    throw new Error('Incomplete encrypted envelope');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(data.iv, 'hex')
  );
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(data.body, 'hex')),
    decipher.final()
  ]).toString('utf8');

  return plaintext;
}

/**
 * Resets the cached key (for testing key rotation scenarios).
 */
function resetKeyCache() {
  cachedKey = null;
}

module.exports = { encrypt, decrypt, resetKeyCache };
