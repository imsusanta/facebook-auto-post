'use strict';

const { query, withTransaction } = require('../db/index');
const { generateUuidV7, isValidUuid } = require('../db/uuid');
const membershipRepository = require('./membership-repository');

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
   */
  async createWorkspaceWithOwner({ name, slug, creatorUserId }) {
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

    return withTransaction(async (client) => {
      const workspaceId = generateUuidV7();

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
      WHERE w.id = $1 AND wm.user_id = $2 AND wm.status = 'active' AND w.deleted_at IS NULL;
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
      WHERE wm.user_id = $1 AND wm.status = 'active' AND w.deleted_at IS NULL
      ORDER BY w.created_at DESC;
    `;
    const { rows } = client ? await client.query(sql, [userId]) : await query(sql, [userId]);
    return rows;
  }

  async update({ workspaceId, updates }, client = null) {
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

    const sql = `
      UPDATE workspaces
      SET ${fields.join(', ')}
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *;
    `;
    const { rows } = client ? await client.query(sql, params) : await query(sql, params);
    return rows[0] || null;
  }
}

module.exports = new WorkspaceRepository();
