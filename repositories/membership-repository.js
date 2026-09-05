'use strict';
const { publicError } = require('../security/public-error');

const { query, withTransaction } = require('../db/index');
const { isValidUuid } = require('../db/uuid');
const auditLogRepository = require('./audit-log-repository');

const { lockPrincipals, requireAdministrator } = require('./authorization-locks');

const VALID_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'viewer'];
const VALID_STATUSES = ['active', 'suspended', 'removed'];

class MembershipRepository {
  async addMember({ workspaceId, userId, role = 'viewer', status = 'active', invitedBy = null }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(userId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId or userId');
    }
    if (!VALID_ROLES.includes(role)) {
      throw publicError('VALIDATION_FAILED', `Invalid role: ${role}. Valid roles are: ${VALID_ROLES.join(', ')}`);
    }
    if (!VALID_STATUSES.includes(status)) {
      throw publicError('VALIDATION_FAILED', `Invalid status: ${status}`);
    }

    const sql = `
      INSERT INTO workspace_members (workspace_id, user_id, role, status, invited_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const params = [workspaceId, userId, role, status, invitedBy];
    const { rows } = client ? await client.query(sql, params) : await query(sql, params);
    return rows[0];
  }

  async findActive({ workspaceId, userId }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(userId)) return null;

    const sql = `
      SELECT
        wm.workspace_id,
        wm.user_id,
        wm.role,
        wm.status,
        wm.joined_at,
        wm.created_at,
        wm.updated_at
      FROM workspace_members wm
      JOIN users u ON wm.user_id = u.id
      JOIN workspaces w ON wm.workspace_id = w.id
      WHERE wm.workspace_id = $1
        AND wm.user_id = $2
        AND wm.status = 'active'
        AND u.status = 'active'
        AND u.deleted_at IS NULL
        AND w.status = 'active'
        AND w.deleted_at IS NULL;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId, userId]) : await query(sql, [workspaceId, userId]);
    return rows[0] || null;
  }

  async getMember({ workspaceId, userId }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(userId)) return null;

    const sql = `
      SELECT * FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId, userId]) : await query(sql, [workspaceId, userId]);
    return rows[0] || null;
  }

  async listMembers({ workspaceId }, client = null) {
    if (!isValidUuid(workspaceId)) return [];

    const sql = `
      SELECT
        wm.workspace_id,
        wm.user_id,
        wm.role,
        wm.status,
        wm.joined_at,
        u.email,
        u.email_normalized
      FROM workspace_members wm
      JOIN users u ON u.id = wm.user_id
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.workspace_id = $1
        AND wm.status != 'removed'
        AND u.deleted_at IS NULL
        AND w.status = 'active'
        AND w.deleted_at IS NULL
      ORDER BY wm.joined_at ASC;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId]) : await query(sql, [workspaceId]);
    return rows;
  }

  async countOwners({ workspaceId }, client = null) {
    if (!isValidUuid(workspaceId)) return 0;

    const sql = `
      SELECT COUNT(*)::int as count
      FROM workspace_members
      WHERE workspace_id = $1 AND role = 'owner' AND status = 'active';
    `;
    const { rows } = client ? await client.query(sql, [workspaceId]) : await query(sql, [workspaceId]);
    return rows[0]?.count || 0;
  }

  /**
   * Atomically updates a member's role inside a workspace-locked transaction.
   * Enforces complete active-principal checks and canonical lock ordering.
   * Atomically records audit event inside transaction.
   */
  async updateRole({ workspaceId, targetUserId, newRole, actorUserId, actorRole = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(targetUserId) || !isValidUuid(actorUserId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId, targetUserId, or actorUserId');
    }
    if (!VALID_ROLES.includes(newRole)) {
      throw publicError('VALIDATION_FAILED', `Invalid role: ${newRole}`);
    }

    // Role-change safety rules:
    // 1. User cannot modify/elevate own role
    if (actorUserId === targetUserId) {
      throw publicError('PERMISSION_DENIED', 'Self-elevation prohibited: Users cannot alter their own membership role.');
    }

    const executeInTx = async (client) => {
      // 1. workspaces lock: verify workspace exists, active, not deleted
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Workspace not found or inactive');
      }

      const principals = await lockPrincipals(client, workspaceId, [actorUserId, targetUserId]);
      const actor = requireAdministrator(principals, actorUserId);
      const target = principals.members.get(targetUserId);
      const targetUser = principals.users.get(targetUserId);
      if (!target || target.status === 'removed' || !targetUser || targetUser.deleted_at !== null) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Target member not found in workspace');
      }

      // 2. Admin cannot grant owner role
      if (actor.role !== 'owner' && newRole === 'owner') {
        throw publicError('PERMISSION_DENIED', 'Privilege violation: Only an owner can grant the owner role.');
      }

      // 3. Admin cannot modify an owner's role
      if (actor.role !== 'owner' && target.role === 'owner') {
        throw publicError('PERMISSION_DENIED', 'Privilege violation: Admins cannot alter an owner membership.');
      }

      // 4. Owner cannot be demoted if they are the final active owner
      if (target.role === 'owner' && newRole !== 'owner') {
        const { rows: countRows } = await client.query(
          `SELECT COUNT(*)::int as count
           FROM workspace_members wm
           JOIN users u ON wm.user_id = u.id
           WHERE wm.workspace_id = $1 AND wm.role = 'owner' AND wm.status = 'active'
             AND u.status = 'active' AND u.deleted_at IS NULL`,
          [workspaceId]
        );
        const activeOwners = countRows[0]?.count || 0;
        if (activeOwners <= 1) {
          throw publicError('PERMISSION_DENIED', 'Safety violation: Cannot demote the final remaining owner without ownership transfer.');
        }
      }

      const { rows: updatedRows } = await client.query(
        'UPDATE workspace_members SET role = $1, updated_at = NOW() WHERE workspace_id = $2 AND user_id = $3 RETURNING *',
        [newRole, workspaceId, targetUserId]
      );

      // Atomically record audit event inside transaction
      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'membership:role_updated',
        resourceType: 'membership',
        resourceId: targetUserId,
        requestId,
        metadata: {
          targetUserId,
          previousRole: target.role,
          newRole
        }
      }, client);

      return updatedRows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Atomically removes a member (status = 'removed') inside a workspace-locked transaction.
   * Follows canonical lock hierarchy: 1. workspaces -> 2. invitations -> 3. members -> 4. users.
   * Inactive/pending invitations for the removed user are automatically revoked.
   * Atomically records audit event inside transaction.
   */
  async removeMember({ workspaceId, targetUserId, actorUserId, actorRole = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(targetUserId) || !isValidUuid(actorUserId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId, targetUserId, or actorUserId');
    }

    const executeInTx = async (client) => {
      // 1. Lock workspace: verify active and not deleted
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Workspace not found or inactive');
      }

      // 2. Lock and revoke obsolete pending invitations for target user in this workspace
      await client.query(
        `UPDATE workspace_invitations
         SET status = 'revoked'
         WHERE workspace_id = $1
           AND email_normalized = (SELECT email_normalized FROM users WHERE id = $2)
           AND status = 'pending'`,
        [workspaceId, targetUserId]
      );

      const principals = await lockPrincipals(client, workspaceId, [actorUserId, targetUserId]);
      const actor = requireAdministrator(principals, actorUserId);
      const target = principals.members.get(targetUserId);
      const targetUser = principals.users.get(targetUserId);
      if (!target || target.status === 'removed' || !targetUser || targetUser.deleted_at !== null) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Target member not found in workspace');
      }

      // Non-owner cannot remove an owner
      if (actor.role !== 'owner' && target.role === 'owner') {
        throw publicError('PERMISSION_DENIED', 'Privilege violation: Only an owner can remove an owner.');
      }

      // Final owner protection: Cannot remove last remaining active owner
      if (target.role === 'owner') {
        const { rows: countRows } = await client.query(
          `SELECT COUNT(*)::int as count
           FROM workspace_members wm
           JOIN users u ON wm.user_id = u.id
           WHERE wm.workspace_id = $1 AND wm.role = 'owner' AND wm.status = 'active'
             AND u.status = 'active' AND u.deleted_at IS NULL`,
          [workspaceId]
        );
        const activeOwners = countRows[0]?.count || 0;
        if (activeOwners <= 1) {
          throw publicError('PERMISSION_DENIED', 'Safety violation: Cannot remove the final remaining workspace owner.');
        }
      }

      // Apply soft removal: status = 'removed'
      const { rows: updatedRows } = await client.query(
        "UPDATE workspace_members SET status = 'removed', updated_at = NOW() WHERE workspace_id = $1 AND user_id = $2 RETURNING *",
        [workspaceId, targetUserId]
      );

      // Atomically record audit event inside transaction
      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'membership:removed',
        resourceType: 'membership',
        resourceId: targetUserId,
        requestId,
        metadata: {
          targetUserId,
          previousRole: target.role
        }
      }, client);

      return updatedRows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }
}

module.exports = new MembershipRepository();
