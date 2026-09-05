'use strict';

const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const { publicError } = require('../security/public-error');
const auditLogRepository = require('./audit-log-repository');

class TenantScheduleRepository {
  async getSchedule({ workspaceId }, client = null) {
    if (!isValidUuid(workspaceId)) return null;

    const sql = `
      SELECT * FROM workspace_schedules
      WHERE workspace_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId]) : await query(sql, [workspaceId]);
    return rows[0] || null;
  }

  async saveSchedule({
    workspaceId,
    pageId = null,
    cronExpression = '0 9,14,20 * * *',
    cronLabel = 'প্রতিদিন ৩ বার (সকাল ৯টা, দুপুর ২টা, রাত ৮টা)',
    status = 'active',
    selectedCategories = [],
    includeAiImage = true,
    actorUserId = null,
    requestId = null
  }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    }
    if (!cronExpression || typeof cronExpression !== 'string' || !cronExpression.trim()) {
      throw publicError('VALIDATION_FAILED', 'Cron expression is required');
    }

    const cleanCron = cronExpression.trim();
    const cleanCategories = Array.isArray(selectedCategories) ? selectedCategories : [];

    const executeInTx = async (client) => {
      // Verify workspace exists
      const { rows: wsRows } = await client.query(
        'SELECT id FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Workspace not found or access denied.');
      }

      // Check existing schedule
      const { rows: existing } = await client.query(
        'SELECT id FROM workspace_schedules WHERE workspace_id = $1 LIMIT 1',
        [workspaceId]
      );

      let schedule;
      if (existing.length > 0) {
        const updateSql = `
          UPDATE workspace_schedules
          SET page_id = $1, cron_expression = $2, cron_label = $3, status = $4,
              selected_categories = $5, include_ai_image = $6, updated_at = NOW()
          WHERE id = $7 AND workspace_id = $8
          RETURNING *;
        `;
        const { rows } = await client.query(updateSql, [
          pageId,
          cleanCron,
          cronLabel,
          status,
          JSON.stringify(cleanCategories),
          Boolean(includeAiImage),
          existing[0].id,
          workspaceId
        ]);
        schedule = rows[0];
      } else {
        const id = generateUuid();
        const insertSql = `
          INSERT INTO workspace_schedules (
            id, workspace_id, page_id, cron_expression, cron_label,
            status, selected_categories, include_ai_image
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *;
        `;
        const { rows } = await client.query(insertSql, [
          id,
          workspaceId,
          pageId,
          cleanCron,
          cronLabel,
          status,
          JSON.stringify(cleanCategories),
          Boolean(includeAiImage)
        ]);
        schedule = rows[0];
      }

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'schedule:saved',
        resourceType: 'schedule',
        resourceId: schedule.id,
        requestId,
        metadata: {
          cronExpression: schedule.cron_expression,
          status: schedule.status
        }
      }, client);

      return schedule;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }
}

module.exports = new TenantScheduleRepository();
