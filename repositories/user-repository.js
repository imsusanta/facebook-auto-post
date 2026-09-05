'use strict';

const crypto = require('crypto');
const { query } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function hashPasswordPbkdf2(password, salt = crypto.randomBytes(16).toString('hex')) {
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `pbkdf2_sha512$100000$${salt}$${hash}`;
}

function verifyPasswordHash(storedHash, candidatePassword) {
  if (!storedHash || !candidatePassword || typeof candidatePassword !== 'string') {
    return false;
  }
  try {
    if (storedHash.startsWith('pbkdf2_sha512$')) {
      const parts = storedHash.split('$');
      if (parts.length !== 4) return false;
      const iterations = parseInt(parts[1], 10);
      const salt = parts[2];
      const expectedHash = parts[3];

      const testHash = crypto.pbkdf2Sync(candidatePassword, salt, iterations, 64, 'sha512').toString('hex');
      const testBuf = Buffer.from(testHash, 'utf8');
      const expBuf = Buffer.from(expectedHash, 'utf8');
      if (testBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(testBuf, expBuf);
    }
    return false;
  } catch {
    return false;
  }
}

function safeSerializeUser(user) {
  if (!user) return null;
  const safe = { ...user };
  delete safe.password_hash;
  delete safe.password_algorithm;
  return safe;
}

class UserRepository {
  async createUser({ email, password, passwordAlgorithm = 'pbkdf2_sha512', status = 'active', emailVerifiedAt = null }, client = null) {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) {
      throw new Error('Valid email address is required');
    }

    const id = generateUuid();
    const passwordHash = hashPasswordPbkdf2(password);

    const sql = `
      INSERT INTO users (id, email, email_normalized, password_hash, password_algorithm, status, email_verified_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const params = [id, email.trim(), normalized, passwordHash, passwordAlgorithm, status, emailVerifiedAt];

    const { rows } = client ? await client.query(sql, params) : await query(sql, params);
    return safeSerializeUser(rows[0]);
  }

  async markEmailVerified(id, verifiedAt = new Date(), client = null) {
    if (!isValidUuid(id)) return null;

    const sql = `
      UPDATE users
      SET email_verified_at = $1, updated_at = NOW()
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING *;
    `;
    const { rows } = client ? await client.query(sql, [verifiedAt, id]) : await query(sql, [verifiedAt, id]);
    return safeSerializeUser(rows[0]);
  }

  async findByEmail(email, client = null) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;

    const sql = `
      SELECT * FROM users
      WHERE email_normalized = $1 AND deleted_at IS NULL;
    `;
    const { rows } = client ? await client.query(sql, [normalized]) : await query(sql, [normalized]);
    return rows[0] || null;
  }

  async findById(id, client = null) {
    if (!isValidUuid(id)) return null;

    const sql = `
      SELECT * FROM users
      WHERE id = $1 AND deleted_at IS NULL;
    `;
    const { rows } = client ? await client.query(sql, [id]) : await query(sql, [id]);
    return rows[0] || null;
  }

  async softDelete(id, client = null) {
    if (!isValidUuid(id)) return false;

    const sql = `
      UPDATE users
      SET deleted_at = NOW(), status = 'suspended', updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL;
    `;
    const { rowCount } = client ? await client.query(sql, [id]) : await query(sql, [id]);
    return rowCount > 0;
  }

  verifyPassword(user, candidatePassword) {
    if (!user || !user.password_hash) return false;
    return verifyPasswordHash(user.password_hash, candidatePassword);
  }

  safeSerialize(user) {
    return safeSerializeUser(user);
  }
}

module.exports = new UserRepository();
