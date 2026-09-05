'use strict';

const { query, withTransaction } = require('../db/index');
const { isValidUuid } = require('../db/uuid');
const auditLogRepository = require('./audit-log-repository');

const VALID_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'viewer'];
const VALID_STATUSES = ['active', 'suspended', 'removed'];

class MembershipRepository {
  async addMember({ workspaceId, userId, role = 'viewer', status = 'active', invitedBy = null }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(userId)) {
      throw new Error('Invalid workspaceId or userId');
    }
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}. Valid roles are: ${VALID_ROLES.join(', ')}`);
    }
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
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
      throw new Error('Invalid workspaceId, targetUserId, or actorUserId');
    }
    if (!VALID_ROLES.includes(newRole)) {
      throw new Error(`Invalid role: ${newRole}`);
    }

    // Role-change safety rules:
    // 1. User cannot modify/elevate own role
    if (actorUserId === targetUserId) {
      throw new Error('Self-elevation prohibited: Users cannot alter their own membership role.');
    }

    const executeInTx = async (client) => {
      // 1. workspaces lock: verify workspace exists, active, not deleted
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw new Error('Workspace not found or inactive');
      }

      // 3. workspace_members lock: reload actor membership and join users
      const { rows: actorRows } = await client.query(
        `SELECT wm.*, u.status as user_status, u.deleted_at as user_deleted_at
         FROM workspace_members wm
         JOIN users u ON wm.user_id = u.id
         WHERE wm.workspace_id = $1 AND wm.user_id = $2 FOR UPDATE`,
        [workspaceId, actorUserId]
      );
      const actor = actorRows[0];
      if (!actor || actor.status !== 'active' || actor.user_status !== 'active' || actor.user_deleted_at !== null) {
        throw new Error('Actor membership not found or not active in workspace');
      }
      if (actor.role !== 'owner' && actor.role !== 'admin') {
        throw new Error('Actor lacks permission to update membership roles');
      }

      // Reload target membership inside transaction
      const { rows: targetRows } = await client.query(
        `SELECT wm.*, u.status as user_status, u.deleted_at as user_deleted_at
         FROM workspace_members wm
         JOIN users u ON wm.user_id = u.id
         WHERE wm.workspace_id = $1 AND wm.user_id = $2 FOR UPDATE`,
        [workspaceId, targetUserId]
      );
      const target = targetRows[0];
      if (!target || target.status === 'removed' || target.user_deleted_at !== null) {
        throw new Error('Target member not found in workspace');
      }

      // 2. Admin cannot grant owner role
      if (actor.role !== 'owner' && newRole === 'owner') {
        throw new Error('Privilege violation: Only an owner can grant the owner role.');
      }

      // 3. Admin cannot modify an owner's role
      if (actor.role !== 'owner' && target.role === 'owner') {
        throw new Error('Privilege violation: Admins cannot alter an owner membership.');
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
          throw new Error('Safety violation: Cannot demote the final remaining owner without ownership transfer.');
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
      throw new Error('Invalid workspaceId, targetUserId, or actorUserId');
    }

    const executeInTx = async (client) => {
      // 1. Lock workspace: verify active and not deleted
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw new Error('Workspace not found or inactive');
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

      // 3. Lock actor membership and verify active principal
      const { rows: actorRows } = await client.query(
        `SELECT wm.*, u.status as user_status, u.deleted_at as user_deleted_at
         FROM workspace_members wm
         JOIN users u ON wm.user_id = u.id
         WHERE wm.workspace_id = $1 AND wm.user_id = $2 FOR UPDATE`,
        [workspaceId, actorUserId]
      );
      const actor = actorRows[0];
      if (!actor || actor.status !== 'active' || actor.user_status !== 'active' || actor.user_deleted_at !== null) {
        throw new Error('Actor membership not found or not active in workspace');
      }
      if (actor.role !== 'owner' && actor.role !== 'admin') {
        throw new Error('Actor lacks permission to remove workspace members');
      }

      // Lock target membership inside transaction
      const { rows: targetRows } = await client.query(
        `SELECT wm.*, u.status as user_status, u.deleted_at as user_deleted_at
         FROM workspace_members wm
         JOIN users u ON wm.user_id = u.id
         WHERE wm.workspace_id = $1 AND wm.user_id = $2 FOR UPDATE`,
        [workspaceId, targetUserId]
      );
      const target = targetRows[0];
      if (!target || target.status === 'removed') {
        throw new Error('Target member not found in workspace');
      }

      // Non-owner cannot remove an owner
      if (actor.role !== 'owner' && target.role === 'owner') {
        throw new Error('Privilege violation: Only an owner can remove an owner.');
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
          throw new Error('Safety violation: Cannot remove the final remaining workspace owner.');
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
