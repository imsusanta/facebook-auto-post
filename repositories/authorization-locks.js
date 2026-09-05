'use strict';
const { publicError } = require('../security/public-error');
const { isValidUuid } = require('../db/uuid');

async function lockWorkspace(client, workspaceId) {
  const { rows } = await client.query('SELECT id FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE', [workspaceId, 'active']);
  if (!rows[0]) throw publicError('WORKSPACE_NOT_FOUND');
  return rows[0];
}
// Caller holds workspace lock, then any invitation locks. Acquire all membership
// locks before any user locks; order shared user rows by UUID across workspaces.
async function lockPrincipals(client, workspaceId, ids) {
  const userIds = [...new Set(ids.filter(isValidUuid))].sort();
  const members = await client.query('SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = ANY($2::uuid[]) ORDER BY user_id FOR UPDATE', [workspaceId, userIds]);
  const users = await client.query('SELECT id, email_normalized, status, deleted_at, email_verified_at FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [userIds]);
  return { members: new Map(members.rows.map(m => [m.user_id, m])), users: new Map(users.rows.map(u => [u.id, u])) };
}
function requireAdministrator(principals, userId) {
  const user = principals.users.get(userId);
  const member = principals.members.get(userId);
  if (!user || user.status !== 'active' || user.deleted_at !== null || !member || member.status !== 'active') throw publicError('WORKSPACE_NOT_FOUND');
  if (!['owner', 'admin'].includes(member.role)) throw publicError('PERMISSION_DENIED');
  return member;
}
module.exports = { lockWorkspace, lockPrincipals, requireAdministrator };
