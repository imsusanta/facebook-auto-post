'use strict';
const crypto = require('crypto');
const { withTransaction, query } = require('../db');
const messages = new Map();
const delivered = new Set();
let failDelivery = false;
function enabled() { return process.env.NODE_ENV === 'test' && process.env.ALLOW_TEST_MAIL === 'true' && process.env.AUTH_MAIL_ADAPTER === 'test'; }
function settings() {
  if (!enabled()) throw new Error('Mail provider is not configured');
  const key = process.env.AUTH_MAIL_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Mail encryption key unavailable');
  const origin = new URL(process.env.AUTH_PUBLIC_ORIGIN || '');
  if (!['http:', 'https:'].includes(origin.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Invalid trusted test origin');
  return { key: Buffer.from(key, 'hex'), origin: origin.origin };
}
function encrypt(id, data) {
  const { key } = settings(); const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), body: ciphertext.toString('hex') });
}
function decrypt(id, payload) {
  const data = JSON.parse(payload); if (data.v !== 1) throw new Error('Unsupported mail envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', settings().key, Buffer.from(data.iv, 'hex'));
  decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.body, 'hex')), decipher.final()]).toString('utf8'));
}
async function enqueue(client, user, purpose, hash, token) {
  const id = crypto.randomUUID();
  const link = `${settings().origin}/account/${purpose === 'verify_email' ? 'verify' : 'reset'}#token=${token}`;
  await client.query('INSERT INTO auth_mail_outbox (id, user_id, token_hash, payload) VALUES ($1,$2,$3,$4)', [id, user.id, hash, encrypt(id, { to: user.email, purpose, link })]);
  return id;
}
async function dispatch(id) {
  settings();
  // Discovery only; authority is checked again under locks. The only implemented
  // adapter is in-memory test capture, never a network call while holding locks.
  const found = await query('SELECT user_id, token_hash FROM auth_mail_outbox WHERE id = $1', [id]);
  if (!found.rows[0]) return;
  try {
    await withTransaction(async client => {
      const { user_id: userId, token_hash: tokenHash } = found.rows[0];
      const u = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const t = await client.query('SELECT *, expires_at > clock_timestamp() AS live FROM auth_action_tokens WHERE token_hash = $1 FOR UPDATE', [tokenHash]);
      const o = await client.query("SELECT * FROM auth_mail_outbox WHERE id = $1 AND state = 'pending' AND available_at <= clock_timestamp() FOR UPDATE", [id]);
      const user = u.rows[0], token = t.rows[0], outbox = o.rows[0];
      if (!outbox) return;
      if (!user || user.deleted_at || !['active', 'pending_verification'].includes(user.status) || !token || !token.live || token.revoked_at || token.consumed_at || token.auth_version !== user.auth_version) {
        await client.query("UPDATE auth_mail_outbox SET state = 'cancelled', payload = NULL WHERE id = $1", [id]); return;
      }
      if (!delivered.has(id)) {
        if (failDelivery || delivered.size >= 2000 || messages.size >= 1000) throw new Error('Test mail delivery unavailable');
        const data = decrypt(id, outbox.payload);
        messages.set(id, { id, ...data }); delivered.add(id);
      }
      await client.query("UPDATE auth_mail_outbox SET state = 'sent', payload = NULL, delivered_at = NOW(), attempts = attempts + 1 WHERE id = $1", [id]);
    });
  } catch (err) {
    // No payload/error text in logs. Idempotency prevents duplicate test delivery
    // if capture succeeded but committing the sent state failed.
    require('../utils/safe-diagnostics')('authentication.mail', err);
    await query("UPDATE auth_mail_outbox SET attempts = attempts + 1, available_at = NOW() + (INTERVAL '1 minute' * power(2, LEAST(attempts, 6))), state = CASE WHEN attempts >= 7 THEN 'cancelled' ELSE 'pending' END, payload = CASE WHEN attempts >= 7 THEN NULL ELSE payload END WHERE id = $1 AND state = 'pending'", [id]);
  }
}
async function drain() {
  settings();
  const rows = await query("SELECT id FROM auth_mail_outbox WHERE state = 'pending' AND available_at <= NOW() ORDER BY created_at LIMIT 50");
  for (const row of rows.rows) await dispatch(row.id);
}
function takeTestMessages() { settings(); const result = [...messages.values()]; messages.clear(); return result; }
function configureTestFailure(value) { settings(); failDelivery = Boolean(value); }
function resetTestMailbox() { settings(); messages.clear(); delivered.clear(); failDelivery = false; }
module.exports = { enabled, settings, enqueue, dispatch, drain, takeTestMessages, configureTestFailure, resetTestMailbox };
