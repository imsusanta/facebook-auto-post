'use strict';

const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const { publicError } = require('../security/public-error');
const auditLogRepository = require('./audit-log-repository');

class TenantPostRepository {
  async createPost({
    workspaceId,
    createdBy = null,
    caption,
    category = null,
    topic = null,
    mediaUrls = [],
    pageId = null,
    status = 'draft',
    scheduledAt = null,
    requestId = null
  }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    }
    if (!caption || typeof caption !== 'string' || !caption.trim()) {
      throw publicError('VALIDATION_FAILED', 'Post caption is required');
    }

    const cleanCaption = caption.trim();
    const cleanMediaUrls = Array.isArray(mediaUrls) ? mediaUrls : [];

    const executeInTx = async (client) => {
      // Lock workspace
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Workspace not found or access denied.');
      }

      const postId = generateUuid();
      const insertPostSql = `
        INSERT INTO workspace_posts (
          id, workspace_id, page_id, status, category, topic,
          caption, media_urls, scheduled_at, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *;
      `;
      const { rows: postRows } = await client.query(insertPostSql, [
        postId,
        workspaceId,
        pageId,
        status,
        category,
        topic,
        cleanCaption,
        JSON.stringify(cleanMediaUrls),
        scheduledAt,
        createdBy
      ]);
      const post = postRows[0];

      // Create version 1
      const versionId = generateUuid();
      const insertVersionSql = `
        INSERT INTO workspace_post_versions (
          id, workspace_id, post_id, version_number, caption, media_urls, created_by
        )
        VALUES ($1, $2, $3, 1, $4, $5, $6)
        RETURNING *;
      `;
      await client.query(insertVersionSql, [
        versionId,
        workspaceId,
        post.id,
        cleanCaption,
        JSON.stringify(cleanMediaUrls),
        createdBy
      ]);

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId: createdBy,
        action: 'post:created',
        resourceType: 'post',
        resourceId: post.id,
        requestId,
        metadata: {
          postId: post.id,
          status: post.status,
          category: post.category
        }
      }, client);

      return post;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  async getPostById({ workspaceId, postId }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(postId)) return null;

    const sql = `
      SELECT * FROM workspace_posts
      WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId, postId]) : await query(sql, [workspaceId, postId]);
    return rows[0] || null;
  }

  async listPosts({ workspaceId, status = null, limit = 50, offset = 0 }, client = null) {
    if (!isValidUuid(workspaceId)) return [];

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const conditions = ['workspace_id = $1', 'deleted_at IS NULL'];
    const params = [workspaceId];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    params.push(safeLimit);
    const limitIdx = params.length;
    params.push(safeOffset);
    const offsetIdx = params.length;

    const sql = `
      SELECT * FROM workspace_posts
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;
    const { rows } = client ? await client.query(sql, params) : await query(sql, params);
    return rows;
  }

  async updatePost({ workspaceId, postId, updates = {}, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(postId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId or postId');
    }

    const executeInTx = async (client) => {
      // 1. Lock post row
      const selectSql = `
        SELECT * FROM workspace_posts
        WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE;
      `;
      const { rows: postRows } = await client.query(selectSql, [workspaceId, postId]);
      const post = postRows[0];
      if (!post) {
        throw publicError('RESOURCE_NOT_FOUND', 'Post not found in workspace.');
      }

      const fields = [];
      const params = [workspaceId, postId];
      let pIdx = 3;

      let contentChanged = false;
      let newCaption = post.caption;
      let newMedia = post.media_urls;

      if (updates.caption && typeof updates.caption === 'string' && updates.caption.trim() !== post.caption) {
        newCaption = updates.caption.trim();
        fields.push(`caption = $${pIdx++}`);
        params.push(newCaption);
        contentChanged = true;
      }

      if (updates.mediaUrls && Array.isArray(updates.mediaUrls)) {
        newMedia = updates.mediaUrls;
        fields.push(`media_urls = $${pIdx++}`);
        params.push(JSON.stringify(newMedia));
        contentChanged = true;
      }

      if (updates.category !== undefined) {
        fields.push(`category = $${pIdx++}`);
        params.push(updates.category);
      }

      if (updates.topic !== undefined) {
        fields.push(`topic = $${pIdx++}`);
        params.push(updates.topic);
      }

      if (updates.status !== undefined) {
        fields.push(`status = $${pIdx++}`);
        params.push(updates.status);
      }

      if (updates.scheduledAt !== undefined) {
        fields.push(`scheduled_at = $${pIdx++}`);
        params.push(updates.scheduledAt);
      }

      if (updates.fbPostId !== undefined) {
        fields.push(`fb_post_id = $${pIdx++}`);
        params.push(updates.fbPostId);
      }

      if (fields.length === 0) return post;

      fields.push('updated_at = NOW()');

      const updateSql = `
        UPDATE workspace_posts
        SET ${fields.join(', ')}
        WHERE workspace_id = $1 AND id = $2
        RETURNING *;
      `;
      const { rows: updatedRows } = await client.query(updateSql, params);
      const updatedPost = updatedRows[0];

      // If content changed, create new version
      if (contentChanged) {
        const { rows: versionRows } = await client.query(
          'SELECT COALESCE(MAX(version_number), 1)::int as max_ver FROM workspace_post_versions WHERE workspace_id = $1 AND post_id = $2',
          [workspaceId, postId]
        );
        const nextVersion = (versionRows[0]?.max_ver || 1) + 1;

        const versionId = generateUuid();
        await client.query(
          `INSERT INTO workspace_post_versions (
            id, workspace_id, post_id, version_number, caption, media_urls, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [versionId, workspaceId, postId, nextVersion, newCaption, JSON.stringify(newMedia), actorUserId]
        );
      }

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'post:updated',
        resourceType: 'post',
        resourceId: postId,
        requestId,
        metadata: {
          postId,
          updates: Object.keys(updates)
        }
      }, client);

      return updatedPost;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  async deletePost({ workspaceId, postId, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(postId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId or postId');
    }

    const executeInTx = async (client) => {
      const sql = `
        UPDATE workspace_posts
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING id, workspace_id;
      `;
      const { rows } = await client.query(sql, [workspaceId, postId]);
      if (rows.length === 0) {
        throw publicError('RESOURCE_NOT_FOUND', 'Post not found in workspace.');
      }

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'post:deleted',
        resourceType: 'post',
        resourceId: postId,
        requestId,
        metadata: { postId }
      }, client);

      return rows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  async getPostVersions({ workspaceId, postId }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(postId)) return [];

    const sql = `
      SELECT * FROM workspace_post_versions
      WHERE workspace_id = $1 AND post_id = $2
      ORDER BY version_number ASC;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId, postId]) : await query(sql, [workspaceId, postId]);
    return rows;
  }
}

module.exports = new TenantPostRepository();
