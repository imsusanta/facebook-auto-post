'use strict';

const { query, withTransaction } = require('../db/index');
const { isValidUuid } = require('../db/uuid');
const { publicError } = require('../security/public-error');
const auditLogRepository = require('./audit-log-repository');

const DEFAULT_WORKSPACE_SETTINGS = {
  isDemoMode: false,
  autoPostEnabled: false,
  intervalMinutes: 15,
  autoPilotEnabled: false,
  selectedCategories: [
    'trending_news',
    'science_nature',
    'history_civilization',
    'psychology_mind',
    'world_geography',
    'tech_inventions',
    'philosophy_wisdom'
  ],
  includeAiImage: true,
  customSystemPrompt: 'ব্যবহারকারীর দেওয়া টপিক ও নির্দেশনা অনুযায়ী আকর্ষণীয়, তথ্যবহুল এবং সম্পূর্ণ মৌলিক ফেসবুক পোস্ট তৈরি করো। বিষয়বস্তুর সাথে মানানসই সুন্দর বাংলা ভাষা, প্রাসঙ্গিক ইমোজি এবং উপযুক্ত ট্রেন্ডিং হ্যাশট্যাগ ব্যবহার করবে।'
};

class TenantSettingsRepository {
  async getSettings({ workspaceId }, client = null) {
    if (!isValidUuid(workspaceId)) return DEFAULT_WORKSPACE_SETTINGS;

    const sql = `
      SELECT settings, updated_at
      FROM workspace_settings
      WHERE workspace_id = $1;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId]) : await query(sql, [workspaceId]);
    if (rows.length === 0) {
      return { ...DEFAULT_WORKSPACE_SETTINGS };
    }
    return { ...DEFAULT_WORKSPACE_SETTINGS, ...(rows[0].settings || {}) };
  }

  async updateSettings({ workspaceId, updates, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw publicError('VALIDATION_FAILED', 'Settings updates must be an object');
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

      const current = await this.getSettings({ workspaceId }, client);
      const merged = { ...current, ...updates };

      const sql = `
        INSERT INTO workspace_settings (workspace_id, settings, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (workspace_id) DO UPDATE SET
          settings = EXCLUDED.settings,
          updated_at = NOW()
        RETURNING settings;
      `;
      const { rows } = await client.query(sql, [workspaceId, JSON.stringify(merged)]);
      const savedSettings = rows[0].settings;

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'settings:updated',
        resourceType: 'settings',
        resourceId: workspaceId,
        requestId,
        metadata: {
          updatedFields: Object.keys(updates)
        }
      }, client);

      return savedSettings;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }
}

module.exports = new TenantSettingsRepository();
