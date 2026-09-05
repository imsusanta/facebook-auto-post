'use strict';

const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const { publicError } = require('../security/public-error');
const auditLogRepository = require('./audit-log-repository');

class TenantMediaRepository {
  async listMedia({ workspaceId, limit = 50, offset = 0 }, client = null) {
    if (!isValidUuid(workspaceId)) return [];

    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    const sql = `
      SELECT id, workspace_id, filename, storage_path, mime_type, size_bytes, uploaded_by, created_at
      FROM workspace_media
      WHERE workspace_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const { rows } = client
      ? await client.query(sql, [workspaceId, safeLimit, safeOffset])
      : await query(sql, [workspaceId, safeLimit, safeOffset]);
    return rows;
  }

  async getMediaById({ workspaceId, mediaId }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(mediaId)) return null;

    const sql = `
      SELECT id, workspace_id, filename, storage_path, mime_type, size_bytes, uploaded_by, created_at
      FROM workspace_media
      WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL;
    `;
    const { rows } = client
      ? await client.query(sql, [workspaceId, mediaId])
      : await query(sql, [workspaceId, mediaId]);
    return rows[0] || null;
  }

  async recordMediaUpload({
    workspaceId,
    filename,
    storagePath,
    mimeType,
    sizeBytes,
    actorUserId = null,
    requestId = null
  }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    }
    if (!filename || typeof filename !== 'string' || !filename.trim()) {
      throw publicError('VALIDATION_FAILED', 'Media filename is required');
    }
    if (!storagePath || typeof storagePath !== 'string' || !storagePath.trim()) {
      throw publicError('VALIDATION_FAILED', 'Storage path is required');
    }

    const executeInTx = async (client) => {
      // Verify workspace exists
      const { rows: wsRows } = await client.query(
        'SELECT id FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Workspace not found or access denied.');
      }

      const id = generateUuid();
      const insertSql = `
        INSERT INTO workspace_media (
          id, workspace_id, filename, storage_path, mime_type, size_bytes, uploaded_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
      `;
      const { rows } = await client.query(insertSql, [
        id,
        workspaceId,
        filename.trim(),
        storagePath.trim(),
        mimeType || 'application/octet-stream',
        parseInt(sizeBytes, 10) || 0,
        actorUserId
      ]);

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'media:uploaded',
        resourceType: 'media',
        resourceId: id,
        metadata: { filename: filename.trim(), mimeType },
        requestId
      }, client);

      return rows[0];
    };

    if (clientOverride) {
      return executeInTx(clientOverride);
    }
    return withTransaction(executeInTx);
  }

  async deleteMedia({ workspaceId, mediaId, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(mediaId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid UUID parameter');
    }

    const executeInTx = async (client) => {
      const { rows } = await client.query(
        `UPDATE workspace_media
         SET deleted_at = NOW()
         WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING *;`,
        [workspaceId, mediaId]
      );

      if (rows.length === 0) {
        throw publicError('RESOURCE_NOT_FOUND', 'Media asset not found or already deleted');
      }

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'media:deleted',
        resourceType: 'media',
        resourceId: mediaId,
        metadata: { filename: rows[0].filename },
        requestId
      }, client);

      return rows[0];
    };

    if (clientOverride) {
      return executeInTx(clientOverride);
    }
    return withTransaction(executeInTx);
  }
}

module.exports = new TenantMediaRepository();
