const router = require('express').Router();
const { z } = require('zod');
const { randomUUID } = require('node:crypto');
const db = require('../services/db');
const auth = require('../security/auth');
const mail = require('../services/mail');
const limit = require('../security/rate-limit');
const email = z.string().trim().toLowerCase().email().max(254),
  password = z.string().min(12).max(128);
const credentials = z.object({ email, password });
function parse(schema, body, res) {
  const result = schema.safeParse(body);
  if (!result.success) {
    res
      .status(400)
      .json({
        error:
          'Invalid input. Use a valid email and a password of 12–128 characters.'
      });
    return null;
  }
  return result.data;
}
const generic = {
  success: true,
  message: 'If the account is eligible, an email will arrive shortly.'
};
async function issue(user, purpose) {
  const token = auth.random();
  await db.transaction(async () => {
    await db.query('DELETE FROM auth_tokens WHERE user_id=$1 AND purpose=$2', [
      user.id,
      purpose
    ]);
    await db.query(
      "INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",
      [auth.hash(token), user.id, purpose]
    );
  });
  try {
    await mail.sendToken(user.email, purpose, token);
  } catch {
    console.warn(
      '[Mail] Delivery failed; check SMTP configuration. No token was logged.'
    );
  }
}
router.use(limit('auth-ip', 30, 900));
router.post('/signup', async (req, res) => {
  const data = parse(
    credentials.extend({ name: z.string().trim().min(1).max(100) }),
    req.body,
    res
  );
  if (!data) return;
  const encoded = await auth.passwordHash(data.password);
  const user = await db.transaction(async () => {
    const id = randomUUID();
    const inserted = await db.query(
      'INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id,email',
      [id, data.email, data.name, encoded]
    );
    if (!inserted.rowCount) return null;
    const ws = randomUUID();
    await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [
      ws,
      `${data.name}'s workspace`
    ]);
    await db.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner')",
      [ws, id]
    );
    return inserted.rows[0];
  });
  if (user) await issue(user, 'verify');
  res.status(202).json(generic);
});
router.post(
  '/login',
  limit('login-account', 10, 900, (req) =>
    String(req.body.email || '')
      .trim()
      .toLowerCase()
  ),
  async (req, res) => {
    const data = parse(credentials, req.body, res);
    if (!data) return;
    const { rows } = await db.query('SELECT * FROM users WHERE email=$1', [
      data.email
    ]);
    const user = rows[0];
    if (
      !(await auth.checkPassword(data.password, user?.password_hash)) ||
      !user?.email_verified_at
    )
      return res
        .status(401)
        .json({ error: 'Invalid credentials or email is not verified' });
    const members = await db.query(
      'SELECT workspace_id FROM workspace_members WHERE user_id=$1 ORDER BY workspace_id LIMIT 1',
      [user.id]
    );
    if (!members.rowCount)
      return res.status(403).json({ error: 'No workspace membership' });
    const csrfToken = await auth.createSession(
      res,
      user.id,
      members.rows[0].workspace_id
    );
    res.json({ success: true, csrfToken });
  }
);
router.post('/resend-verification', async (req, res) => {
  const data = parse(z.object({ email }), req.body, res);
  if (!data) return;
  const { rows } = await db.query(
    'SELECT id,email FROM users WHERE email=$1 AND email_verified_at IS NULL',
    [data.email]
  );
  if (rows[0]) await issue(rows[0], 'verify');
  res.status(202).json(generic);
});
router.post('/forgot-password', async (req, res) => {
  const data = parse(z.object({ email }), req.body, res);
  if (!data) return;
  const { rows } = await db.query(
    'SELECT id,email FROM users WHERE email=$1 AND email_verified_at IS NOT NULL',
    [data.email]
  );
  if (rows[0]) await issue(rows[0], 'reset');
  res.status(202).json(generic);
});
async function consume(token, purpose, fn) {
  return db.transaction(async () => {
    const { rows } = await db.query(
      'DELETE FROM auth_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING user_id',
      [auth.hash(token), purpose]
    );
    if (!rows[0]) return false;
    await fn(rows[0].user_id);
    return true;
  });
}
router.post('/verify-email', async (req, res) => {
  const data = parse(
    z.object({ token: z.string().regex(/^[a-f\d]{64}$/) }),
    req.body,
    res
  );
  if (!data) return;
  const ok = await consume(data.token, 'verify', (id) =>
    db.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [id])
  );
  res
    .status(ok ? 200 : 400)
    .json({
      success: ok,
      message: ok
        ? 'Email verified. You can sign in.'
        : 'Invalid or expired link'
    });
});
router.post('/reset-password', async (req, res) => {
  const data = parse(
    z.object({ token: z.string().regex(/^[a-f\d]{64}$/), password }),
    req.body,
    res
  );
  if (!data) return;
  const encoded = await auth.passwordHash(data.password);
  const ok = await consume(data.token, 'reset', async (id) => {
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
      encoded,
      id
    ]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    require('../middleware/sse').revokeUser(id);
  });
  res
    .status(ok ? 200 : 400)
    .json({
      success: ok,
      message: ok ? 'Password reset. Sign in again.' : 'Invalid or expired link'
    });
});
router.get('/workspaces', auth.authenticate, async (req, res) => {
  const { rows } = await db.query(
    'SELECT w.id,w.name,m.role FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY w.name',
    [req.user.id]
  );
  res.json({ workspaces: rows });
});
router.post('/switch-workspace', auth.authenticate, async (req, res) => {
  const data = parse(
    z.object({ workspaceId: z.uuid() }).strict(),
    req.body,
    res
  );
  if (!data) return;
  const membership = await db.query(
    'SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
    [data.workspaceId, req.user.id]
  );
  if (!membership.rowCount)
    return res.status(403).json({ error: 'Not a workspace member' });
  await db.query('DELETE FROM sessions WHERE token_hash=$1', [
    req.user.token_hash
  ]);
  require('../middleware/sse').revokeSession(req.user.token_hash);
  const csrfToken = await auth.createSession(
    res,
    req.user.id,
    data.workspaceId
  );
  res.json({ success: true, csrfToken });
});
router.get('/me', auth.authenticate, (req, res) =>
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      workspaceId: req.user.workspace_id
    },
    csrfToken: req.user.csrf_token
  })
);
router.post('/logout', auth.authenticate, async (req, res) => {
  await db.query('DELETE FROM sessions WHERE token_hash=$1', [
    req.user.token_hash
  ]);
  require('../middleware/sse').revokeSession(req.user.token_hash);
  auth.clearCookie(res);
  res.json({ success: true });
});
module.exports = router;
