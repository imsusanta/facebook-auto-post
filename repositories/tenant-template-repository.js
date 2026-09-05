'use strict';

const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const { publicError } = require('../security/public-error');
const auditLogRepository = require('./audit-log-repository');

class TenantTemplateRepository {
  async listTemplates({ workspaceId }, client = null) {
    if (!isValidUuid(workspaceId)) return [];

    const sql = `
      SELECT id, workspace_id, slug, title, badge, category, description, sample, created_at, updated_at
      FROM workspace_templates
      WHERE workspace_id = $1
      ORDER BY created_at ASC;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId]) : await query(sql, [workspaceId]);
    return rows;
  }

  async getTemplateById({ workspaceId, templateId }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(templateId)) return null;

    const sql = `
      SELECT id, workspace_id, slug, title, badge, category, description, sample, created_at, updated_at
      FROM workspace_templates
      WHERE workspace_id = $1 AND id = $2;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId, templateId]) : await query(sql, [workspaceId, templateId]);
    return rows[0] || null;
  }

  async createTemplate({
    workspaceId,
    slug,
    title,
    badge = null,
    category = null,
    description = null,
    sample,
    actorUserId = null,
    requestId = null
  }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    }
    if (!slug || typeof slug !== 'string' || !slug.trim()) {
      throw publicError('VALIDATION_FAILED', 'Template slug is required');
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      throw publicError('VALIDATION_FAILED', 'Template title is required');
    }
    if (!sample || typeof sample !== 'string' || !sample.trim()) {
      throw publicError('VALIDATION_FAILED', 'Template sample text is required');
    }

    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const cleanTitle = title.trim();
    const cleanSample = sample.trim();

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
        INSERT INTO workspace_templates (
          id, workspace_id, slug, title, badge, category, description, sample
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (workspace_id, slug) DO UPDATE SET
          title = EXCLUDED.title,
          badge = EXCLUDED.badge,
          category = EXCLUDED.category,
          description = EXCLUDED.description,
          sample = EXCLUDED.sample,
          updated_at = NOW()
        RETURNING *;
      `;
      const { rows } = await client.query(insertSql, [
        id,
        workspaceId,
        cleanSlug,
        cleanTitle,
        badge,
        category,
        description,
        cleanSample
      ]);
      const template = rows[0];

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'template:created',
        resourceType: 'template',
        resourceId: template.id,
        requestId,
        metadata: {
          slug: template.slug,
          title: template.title
        }
      }, client);

      return template;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  async deleteTemplate({ workspaceId, templateId, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(templateId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId or templateId');
    }

    const executeInTx = async (client) => {
      const sql = `
        DELETE FROM workspace_templates
        WHERE workspace_id = $1 AND id = $2
        RETURNING id, workspace_id, slug;
      `;
      const { rows } = await client.query(sql, [workspaceId, templateId]);
      if (rows.length === 0) {
        throw publicError('RESOURCE_NOT_FOUND', 'Template not found in workspace.');
      }

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'template:deleted',
        resourceType: 'template',
        resourceId: templateId,
        requestId,
        metadata: { slug: rows[0].slug }
      }, client);

      return rows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }
}

module.exports = new TenantTemplateRepository();
