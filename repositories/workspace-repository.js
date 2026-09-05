'use strict';

const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const membershipRepository = require('./membership-repository');
const auditLogRepository = require('./audit-log-repository');

function normalizeSlug(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

class WorkspaceRepository {
  /**
   * Atomically creates a workspace and seeds the creator as the initial OWNER member.
   * If member creation fails, the workspace creation is completely rolled back.
   * Atomically records audit event inside transaction.
   */
  async createWorkspaceWithOwner({ name, slug, creatorUserId, requestId = null }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Workspace name is required');
    }
    if (!isValidUuid(creatorUserId)) {
      throw new Error('Valid creatorUserId is required');
    }

    const cleanSlug = normalizeSlug(slug || name);
    if (!cleanSlug) {
      throw new Error('Valid workspace slug could not be derived');
    }

    // Verify creator user is active and not deleted
    const { rows: userRows } = await query(
      'SELECT id, status, deleted_at FROM users WHERE id = $1 AND deleted_at IS NULL',
      [creatorUserId]
    );
    const creator = userRows[0];
    if (!creator || creator.status !== 'active') {
      throw new Error('Creator user not found or inactive');
    }

    return withTransaction(async (client) => {
      const workspaceId = generateUuid();

      const insertWorkspaceSql = `
        INSERT INTO workspaces (id, name, slug, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `;
      const { rows: wsRows } = await client.query(insertWorkspaceSql, [
        workspaceId,
        name.trim(),
        cleanSlug,
        creatorUserId
      ]);
      const workspace = wsRows[0];

      // Insert owner membership atomically
      await membershipRepository.addMember(
        {
          workspaceId: workspace.id,
          userId: creatorUserId,
          role: 'owner',
          status: 'active'
        },
        client
      );

      // Atomically record audit event inside transaction
      await auditLogRepository.recordEvent({
        workspaceId: workspace.id,
        actorUserId: creatorUserId,
        action: 'workspace:create',
        resourceType: 'workspace',
        resourceId: workspace.id,
        requestId,
        metadata: {
          name: workspace.name,
          slug: workspace.slug
        }
      }, client);

      return workspace;
    });
  }

  async getByIdForUser({ workspaceId, userId }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(userId)) return null;

    const sql = `
      SELECT
        w.id,
        w.name,
        w.slug,
        w.status,
        w.created_by,
        w.created_at,
        w.updated_at,
        wm.role AS member_role
      FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      JOIN users u ON wm.user_id = u.id
      WHERE w.id = $1 AND wm.user_id = $2
        AND wm.status = 'active'
        AND w.status = 'active' AND w.deleted_at IS NULL
        AND u.status = 'active' AND u.deleted_at IS NULL;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId, userId]) : await query(sql, [workspaceId, userId]);
    return rows[0] || null;
  }

  async listForUser({ userId }, client = null) {
    if (!isValidUuid(userId)) return [];

    const sql = `
      SELECT
        w.id,
        w.name,
        w.slug,
        w.status,
        w.created_by,
        w.created_at,
        w.updated_at,
        wm.role AS member_role
      FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      JOIN users u ON wm.user_id = u.id
      WHERE wm.user_id = $1
        AND wm.status = 'active'
        AND w.status = 'active' AND w.deleted_at IS NULL
        AND u.status = 'active' AND u.deleted_at IS NULL
      ORDER BY w.created_at DESC;
    `;
    const { rows } = client ? await client.query(sql, [userId]) : await query(sql, [userId]);
    return rows;
  }

  async update({ workspaceId, updates, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) return null;

    const fields = [];
    const params = [workspaceId];
    let pIdx = 2;

    if (updates.name && typeof updates.name === 'string') {
      fields.push(`name = $${pIdx++}`);
      params.push(updates.name.trim());
    }

    if (updates.slug && typeof updates.slug === 'string') {
      const cleanSlug = normalizeSlug(updates.slug);
      if (!cleanSlug) throw new Error('Invalid slug');
      fields.push(`slug = $${pIdx++}`);
      params.push(cleanSlug);
    }

    if (fields.length === 0) return null;

    fields.push('updated_at = NOW()');

    const executeInTx = async (client) => {
      const sql = `
        UPDATE workspaces
        SET ${fields.join(', ')}
        WHERE id = $1 AND status = 'active' AND deleted_at IS NULL
        RETURNING *;
      `;
      const { rows } = await client.query(sql, params);
      const updated = rows[0] || null;

      if (updated && actorUserId) {
        await auditLogRepository.recordEvent({
          workspaceId,
          actorUserId,
          action: 'workspace:update',
          resourceType: 'workspace',
          resourceId: workspaceId,
          requestId,
          metadata: updates
        }, client);
      }

      return updated;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }
}

module.exports = new WorkspaceRepository();
