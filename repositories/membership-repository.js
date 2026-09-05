'use strict';

const { query, withTransaction } = require('../db/index');
const { isValidUuid } = require('../db/uuid');

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
      SELECT * FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2 AND status = 'active';
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
      WHERE wm.workspace_id = $1 AND wm.status != 'removed'
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
   * Reloads actor membership from the database to prevent stale role bypass.
   */
  async updateRole({ workspaceId, targetUserId, newRole, actorUserId, actorRole = null }, clientOverride = null) {
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
      // Lock workspace to serialize concurrent ownership modifications
      const { rows: wsRows } = await client.query(
        'SELECT id FROM workspaces WHERE id = $1 FOR UPDATE',
        [workspaceId]
      );
      if (wsRows.length === 0) {
        throw new Error('Workspace not found');
      }

      // Reload actor membership authoritatively from DB inside transaction
      const { rows: actorRows } = await client.query(
        'SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE',
        [workspaceId, actorUserId]
      );
      const actor = actorRows[0];
      if (!actor || actor.status !== 'active') {
        throw new Error('Actor membership not found or not active in workspace');
      }
      if (actor.role !== 'owner' && actor.role !== 'admin') {
        throw new Error('Actor lacks permission to update membership roles');
      }

      // Reload target membership inside transaction
      const { rows: targetRows } = await client.query(
        'SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE',
        [workspaceId, targetUserId]
      );
      const target = targetRows[0];
      if (!target || target.status === 'removed') {
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
          "SELECT COUNT(*)::int as count FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'",
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
      return updatedRows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Atomically removes a member (status = 'removed') inside a workspace-locked transaction.
   * Reloads actor membership from the database and protects the final active owner.
   */
  async removeMember({ workspaceId, targetUserId, actorUserId, actorRole = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(targetUserId) || !isValidUuid(actorUserId)) {
      throw new Error('Invalid workspaceId, targetUserId, or actorUserId');
    }

    const executeInTx = async (client) => {
      // Lock workspace to serialize concurrent member removals
      const { rows: wsRows } = await client.query(
        'SELECT id FROM workspaces WHERE id = $1 FOR UPDATE',
        [workspaceId]
      );
      if (wsRows.length === 0) {
        throw new Error('Workspace not found');
      }

      // Reload actor membership authoritatively from DB inside transaction
      const { rows: actorRows } = await client.query(
        'SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE',
        [workspaceId, actorUserId]
      );
      const actor = actorRows[0];
      if (!actor || actor.status !== 'active') {
        throw new Error('Actor membership not found or not active in workspace');
      }
      if (actor.role !== 'owner' && actor.role !== 'admin') {
        throw new Error('Actor lacks permission to remove workspace members');
      }

      // Reload target membership inside transaction
      const { rows: targetRows } = await client.query(
        'SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE',
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
          "SELECT COUNT(*)::int as count FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'",
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
      return updatedRows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }
}

module.exports = new MembershipRepository();
