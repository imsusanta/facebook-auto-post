const db = require('../services/db');
const { hash } = require('./auth');
function limit(name, max, seconds, keyFn = (req) => req.ip) {
  return async (req, res, next) => {
    const key = hash(`${name}:${keyFn(req)}`);
    const { rows } = await db.query(
      `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second')
      ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,
      expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING hits`,
      [key, seconds]
    );
    if (rows[0].hits > max) {
      res.set('Retry-After', String(seconds));
      return res
        .status(429)
        .json({ error: 'Too many requests. Try again later.' });
    }
    next();
  };
}
module.exports = limit;
