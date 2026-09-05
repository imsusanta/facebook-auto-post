'use strict';

const { query } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const passwords = require('../security/passwords');
function normalizeEmail(email) { return typeof email === 'string' ? email.trim().toLowerCase() : ''; }

function safeSerializeUser(user) {
  if (!user) return null;
  const safe = { ...user };
  delete safe.password_hash;
  delete safe.password_algorithm;
  return safe;
}

class UserRepository {
  async createUser({ email, password, passwordAlgorithm = 'argon2id', status = 'active', emailVerifiedAt = null }, client = null) {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) {
      throw new Error('Valid email address is required');
    }

    const id = generateUuid();
    if (passwordAlgorithm !== 'argon2id') throw new Error('New user passwords require argon2id');
    const passwordHash = await passwords.hash(password);

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

    return require('../services/account-lifecycle').makeInactive(id, true, null, client);
  }

  async suspendUser(id, client = null) {
    if (!isValidUuid(id)) return false;
    return require('../services/account-lifecycle').makeInactive(id, false, null, client);
  }

  async verifyPassword(user, candidatePassword) {
    return user ? passwords.verify(user.password_hash, candidatePassword) : false;
  }

  safeSerialize(user) {
    return safeSerializeUser(user);
  }
}

module.exports = new UserRepository();
