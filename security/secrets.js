const crypto = require('node:crypto');
const SECRET_KEYS =
  /^(accessToken|page_access_token|geminiApiKey|gemini_api_key|webhookVerifyToken|password|password_hash|token_hash|csrf_token)$/i;
function key() {
  const k = process.env.DATA_ENCRYPTION_KEY || '';
  if (!/^[a-f\d]{64}$/i.test(k)) throw new Error('Invalid encryption key');
  return Buffer.from(k, 'hex');
}
function encrypt(value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final()
  ]);
  return {
    $encrypted: 'v1',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    value: ciphertext.toString('base64')
  };
}
function walk(value, decode = false) {
  if (Array.isArray(value)) return value.map((v) => walk(v, decode));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k) && v) {
      if (!decode && typeof v === 'string') out[k] = encrypt(v);
      else if (decode && v.$encrypted === 'v1') {
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          key(),
          Buffer.from(v.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(v.tag, 'base64'));
        out[k] = Buffer.concat([
          decipher.update(Buffer.from(v.value, 'base64')),
          decipher.final()
        ]).toString('utf8');
      } else if (decode)
        throw new Error(
          'Unencrypted secret in database; explicit migration required'
        );
      else out[k] = v;
    } else out[k] = walk(v, decode);
  }
  return out;
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k)) {
      if (k === 'accessToken') out.hasAccessToken = !!v;
      if (k === 'geminiApiKey') out.hasGeminiApiKey = !!v;
      continue;
    }
    if (k === 'localPath' || k === 'path' || k === '$encrypted') continue;
    out[k] = redact(v);
  }
  return out;
}
module.exports = { seal: (v) => walk(v), open: (v) => walk(v, true), redact };
