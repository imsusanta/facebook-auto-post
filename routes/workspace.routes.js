const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { current } = require('../security/context');
router.get('/members', async (req, res) => {
  const { rows } = await db.query(
    'SELECT u.id,u.name,u.email,m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.name',
    [current().workspaceId]
  );
  res.json({ members: rows });
});
router.post('/members', async (req, res) => {
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email().max(254),
      role: z.enum(['editor', 'viewer'])
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: 'Valid email and editor/viewer role required' });
  const { rows } = await db.query(
    'SELECT id FROM users WHERE email=$1 AND email_verified_at IS NOT NULL',
    [parsed.data.email]
  );
  if (!rows[0])
    return res
      .status(400)
      .json({ error: 'Member must first create and verify their own account' });
  const result = await db.transaction(async () => {
    const existing = await db.query(
      'SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
      [current().workspaceId, rows[0].id]
    );
    if (existing.rows[0]?.role === 'owner') return false;
    await db.query(
      'INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role',
      [current().workspaceId, rows[0].id, parsed.data.role]
    );
    await db.query(
      'INSERT INTO audit_logs(workspace_id,user_id,action) VALUES($1,$2,$3)',
      [current().workspaceId, req.user.id, 'membership.updated']
    );
    return true;
  }, current().workspaceId);
  res
    .status(result ? 200 : 409)
    .json(
      result
        ? { success: true }
        : { error: 'Owner role cannot be changed here' }
    );
});
router.delete('/members/:id', async (req, res) => {
  if (!z.uuid().safeParse(req.params.id).success)
    return res.status(400).json({ error: 'Invalid member ID' });
  const { rowCount } = await db.query(
    "DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role<>'owner'",
    [current().workspaceId, req.params.id]
  );
  require('../middleware/sse').revokeUser(req.params.id);
  res
    .status(rowCount ? 200 : 404)
    .json(
      rowCount ? { success: true } : { error: 'Removable member not found' }
    );
});
module.exports = router;
