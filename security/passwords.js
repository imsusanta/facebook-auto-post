'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const argon2 = require('argon2');
const pbkdf2 = promisify(crypto.pbkdf2);
const OPTIONS = Object.freeze({ type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32 });
class PasswordPolicyError extends Error {}
let active = 0;
// Fail closed instead of an unbounded work queue. The HTTP layer maps saturation
// to a generic retryable error; this is in addition to the shared rate limiter.
async function bounded(work) {
  if (active >= 4) { const e = new Error('Password service busy'); e.code = 'AUTH_BUSY'; throw e; }
  active++;
  try { return await work(); } finally { active--; }
}
function validPassword(value) { return typeof value === 'string' && [...value].length >= 12 && Buffer.byteLength(value) <= 1024; }
async function hash(password, enforcePolicy = true) {
  if (enforcePolicy ? !validPassword(password) : (typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024)) { throw new PasswordPolicyError('Password length invalid'); }
  return bounded(() => argon2.hash(password, OPTIONS));
}
async function verify(stored, password) {
  if (typeof stored !== 'string' || typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024) return false;
  const old = /^pbkdf2_sha512\$100000\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);
  if (old) {
    return bounded(async () => {
      const actual = await pbkdf2(password, old[1], 100000, 64, 'sha512');
      return crypto.timingSafeEqual(actual, Buffer.from(old[2], 'hex'));
    });
  }
  const modern = /^\$argon2id\$v=19\$([^$]{1,40})\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(stored);
  if (!modern) return false;
  const entries = modern[1].split(',');
  if (entries.length !== 3 || entries.some(x => !/^[mtp]=[0-9]{1,5}$/.test(x))) return false;
  const params = Object.fromEntries(entries.map(x => { const [key, value] = x.split('='); return [key, Number(value)]; }));
  if (Object.keys(params).length !== 3 || params.m < 19456 || params.m > 65536 || params.t < 2 || params.t > 4 || params.p < 1 || params.p > 2) return false;
  return bounded(async () => {
    try { return await argon2.verify(stored, password); } catch { return false; }
  });
}
async function dummyVerify(password) {
  // Do comparable bounded work for an unknown account without generating a
  // different response or returning account-existence information.
  return bounded(() => argon2.hash(typeof password === 'string' ? password : '', { ...OPTIONS, salt: Buffer.alloc(16) }));
}
module.exports = { hash, verify, validPassword, dummyVerify, OPTIONS, PasswordPolicyError };
