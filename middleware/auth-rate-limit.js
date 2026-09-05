'use strict';
const crypto = require('crypto');
const { withTransaction } = require('../db');
// Shared PostgreSQL buckets; IP-derived values are keyed hashes, not raw IPs or
// emails. No attacker-controlled account lockouts or unbounded in-process maps.
const POLICIES = Object.freeze({ login: 20, signup: 5, resend: 5, recovery: 5, action: 30, session: 120, change: 10 });
module.exports = function authRateLimit(operation) {
  if (!Object.hasOwn(POLICIES, operation)) throw new Error('Unknown rate policy');
  return async (req, res, next) => {
    try {
      const key = process.env.AUTH_RATE_LIMIT_KEY;
      if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Rate limit key unavailable');
      const bucket = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(`${operation}:${req.ip || req.socket.remoteAddress}`).digest('hex');
      const allowed = await withTransaction(async client => {
        // One bounded table lock serializes admission/cap checks across instances.
        // This intentionally simple pre-production design needs load testing.
        await client.query('LOCK TABLE auth_rate_buckets IN SHARE ROW EXCLUSIVE MODE');
        await client.query('DELETE FROM auth_rate_buckets WHERE expires_at <= NOW()');
        const current = await client.query('SELECT hits FROM auth_rate_buckets WHERE bucket_key = $1', [bucket]);
        if (current.rows[0]) {
          if (current.rows[0].hits >= POLICIES[operation]) return false;
          await client.query('UPDATE auth_rate_buckets SET hits = hits + 1 WHERE bucket_key = $1', [bucket]);
          return true;
        }
        const count = await client.query('SELECT COUNT(*)::int AS n FROM auth_rate_buckets');
        if (count.rows[0].n >= 10000) return false;
        await client.query("INSERT INTO auth_rate_buckets (bucket_key, hits, expires_at) VALUES ($1, 1, NOW() + INTERVAL '15 minutes')", [bucket]);
        return true;
      });
      if (!allowed) return res.status(429).json({ code: 'RATE_LIMITED', error: 'Please try again later.', requestId: req.requestId });
      next();
    } catch (err) {
      require('../utils/safe-diagnostics')('authentication.rate_limit', err, req.requestId);
      res.status(503).json({ code: 'AUTH_UNAVAILABLE', error: 'Authentication temporarily unavailable.', requestId: req.requestId });
    }
  };
};
