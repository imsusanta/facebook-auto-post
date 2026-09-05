'use strict';

const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const { publicError } = require('../security/public-error');
const auditLogRepository = require('./audit-log-repository');

class TenantPageRepository {
  async listPages({ workspaceId }, client = null) {
    if (!isValidUuid(workspaceId)) return [];

    const sql = `
      SELECT id, workspace_id, page_id, page_name, status, is_default, category, system_prompt, created_at, updated_at
      FROM workspace_pages
      WHERE workspace_id = $1 AND deleted_at IS NULL
      ORDER BY is_default DESC, created_at ASC;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId]) : await query(sql, [workspaceId]);
    return rows;
  }

  async getPageById({ workspaceId, pageId }, client = null) {
    if (!isValidUuid(workspaceId) || !pageId) return null;

    const sql = `
      SELECT id, workspace_id, page_id, page_name, status, is_default, category, system_prompt, created_at, updated_at
      FROM workspace_pages
      WHERE workspace_id = $1 AND page_id = $2 AND deleted_at IS NULL;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId, String(pageId)]) : await query(sql, [workspaceId, String(pageId)]);
    return rows[0] || null;
  }

  async connectPage({
    workspaceId,
    pageId,
    pageName,
    accessToken = null,
    category = 'General',
    systemPrompt = null,
    isDefault = false,
    actorUserId = null,
    requestId = null
  }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    }
    if (!pageId || typeof pageId !== 'string' || !pageId.trim()) {
      throw publicError('VALIDATION_FAILED', 'Page ID is required');
    }
    if (!pageName || typeof pageName !== 'string' || !pageName.trim()) {
      throw publicError('VALIDATION_FAILED', 'Page name is required');
    }

    const cleanPageId = pageId.trim();
    const cleanPageName = pageName.trim();

    const executeInTx = async (client) => {
      // 1. Lock workspace
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Workspace not found or access denied.');
      }

      // 2. Count existing pages to determine if this should be default
      const { rows: countRows } = await client.query(
        'SELECT COUNT(*)::int as count FROM workspace_pages WHERE workspace_id = $1 AND deleted_at IS NULL',
        [workspaceId]
      );
      const shouldBeDefault = isDefault || countRows[0].count === 0;

      if (shouldBeDefault) {
        await client.query(
          'UPDATE workspace_pages SET is_default = false WHERE workspace_id = $1',
          [workspaceId]
        );
      }

      const id = generateUuid();
      const insertSql = `
        INSERT INTO workspace_pages (
          id, workspace_id, page_id, page_name, access_token_encrypted,
          status, is_default, category, system_prompt
        )
        VALUES ($1, $2, $3, $4, $5, 'connected', $6, $7, $8)
        ON CONFLICT (workspace_id, page_id) DO UPDATE SET
          page_name = EXCLUDED.page_name,
          access_token_encrypted = COALESCE(EXCLUDED.access_token_encrypted, workspace_pages.access_token_encrypted),
          status = 'connected',
          is_default = EXCLUDED.is_default,
          category = EXCLUDED.category,
          system_prompt = EXCLUDED.system_prompt,
          deleted_at = NULL,
          updated_at = NOW()
        RETURNING id, workspace_id, page_id, page_name, status, is_default, category, system_prompt, created_at, updated_at;
      `;
      const { rows } = await client.query(insertSql, [
        id,
        workspaceId,
        cleanPageId,
        cleanPageName,
        accessToken,
        shouldBeDefault,
        category || 'General',
        systemPrompt
      ]);

      const connected = rows[0];

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'page:connected',
        resourceType: 'page',
        resourceId: connected.page_id,
        requestId,
        metadata: {
          pageId: connected.page_id,
          pageName: connected.page_name,
          isDefault: connected.is_default
        }
      }, client);

      return connected;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  async disconnectPage({ workspaceId, pageId, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !pageId) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId or pageId');
    }

    const cleanPageId = String(pageId).trim();

    const executeInTx = async (client) => {
      const sql = `
        UPDATE workspace_pages
        SET status = 'disconnected', deleted_at = NOW(), updated_at = NOW()
        WHERE workspace_id = $1 AND page_id = $2 AND deleted_at IS NULL
        RETURNING id, workspace_id, page_id, page_name, status;
      `;
      const { rows } = await client.query(sql, [workspaceId, cleanPageId]);
      if (rows.length === 0) {
        throw publicError('RESOURCE_NOT_FOUND', 'Page not found in workspace.');
      }

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'page:disconnected',
        resourceType: 'page',
        resourceId: cleanPageId,
        requestId,
        metadata: { pageId: cleanPageId }
      }, client);

      return rows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  async setDefaultPage({ workspaceId, pageId, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !pageId) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId or pageId');
    }

    const cleanPageId = String(pageId).trim();

    const executeInTx = async (client) => {
      const checkSql = `
        SELECT id FROM workspace_pages
        WHERE workspace_id = $1 AND page_id = $2 AND deleted_at IS NULL;
      `;
      const { rows: checkRows } = await client.query(checkSql, [workspaceId, cleanPageId]);
      if (checkRows.length === 0) {
        throw publicError('RESOURCE_NOT_FOUND', 'Page not found in workspace.');
      }

      await client.query(
        'UPDATE workspace_pages SET is_default = false WHERE workspace_id = $1',
        [workspaceId]
      );

      const updateSql = `
        UPDATE workspace_pages
        SET is_default = true, updated_at = NOW()
        WHERE workspace_id = $1 AND page_id = $2
        RETURNING id, workspace_id, page_id, page_name, is_default;
      `;
      const { rows } = await client.query(updateSql, [workspaceId, cleanPageId]);

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'page:set_default',
        resourceType: 'page',
        resourceId: cleanPageId,
        requestId,
        metadata: { pageId: cleanPageId }
      }, client);

      return rows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }
}

module.exports = new TenantPageRepository();
