'use strict';

const { query } = require('../db/index');
const { generateUuidV7, isValidUuid } = require('../db/uuid');

const SENSITIVE_KEY_REGEX = /password|secret|token|authorization|cookie|key|credential|jwt|bearer/i;

function sanitizeMetadata(val, depth = 0) {
  if (depth > 5) return '[DEPTH_LIMIT]';
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') {
    if (typeof val === 'string' && val.length > 500) {
      return val.substring(0, 500) + '...[TRUNCATED]';
    }
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => sanitizeMetadata(item, depth + 1));
  }

  const sanitized = {};
  for (const [key, item] of Object.entries(val)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeMetadata(item, depth + 1);
    }
  }
  return sanitized;
}

class AuditLogRepository {
  /**
   * Append-only audit log writer.
   * Note: Audit logs are stored append-only in PostgreSQL with strict application-level
   * boundaries; they are not cryptographically immutable unless external tamper-evident
   * write-once storage is configured.
   */
  async recordEvent({
    workspaceId,
    actorUserId = null,
    action,
    resourceType,
    resourceId = null,
    outcome = 'success',
    requestId = null,
    ipHash = null,
    userAgentSummary = null,
    metadata = {}
  }, client = null) {
    if (!isValidUuid(workspaceId)) {
      throw new Error('Valid workspaceId UUID is required for audit logging');
    }
    if (actorUserId && !isValidUuid(actorUserId)) {
      throw new Error('Invalid actorUserId UUID');
    }
    if (!action || typeof action !== 'string') {
      throw new Error('Action is required for audit logging');
    }
    if (!resourceType || typeof resourceType !== 'string') {
      throw new Error('ResourceType is required for audit logging');
    }

    const id = generateUuidV7();
    const cleanMetadata = sanitizeMetadata(metadata);

    const sql = `
      INSERT INTO audit_logs (
        id, workspace_id, actor_user_id, action, resource_type,
        resource_id, outcome, request_id, ip_hash, user_agent_summary, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, workspace_id, actor_user_id, action, resource_type,
                resource_id, outcome, request_id, user_agent_summary, metadata, created_at;
    `;
    const params = [
      id,
      workspaceId,
      actorUserId,
      action,
      resourceType,
      resourceId ? String(resourceId) : null,
      outcome,
      requestId,
      ipHash,
      userAgentSummary,
      JSON.stringify(cleanMetadata)
    ];

    try {
      const { rows } = client ? await client.query(sql, params) : await query(sql, params);
      return rows[0];
    } catch (err) {
      console.error(`[AuditLogRepository] CRITICAL: Failed to write audit event for workspace ${workspaceId}:`, err.message);
      throw err;
    }
  }

  /**
   * Reads audit logs scoped strictly to the specified workspaceId.
   */
  async listByWorkspace({
    workspaceId,
    limit = 50,
    offset = 0,
    resourceType = null,
    action = null
  }, client = null) {
    if (!isValidUuid(workspaceId)) return [];

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const conditions = ['workspace_id = $1'];
    const params = [workspaceId];
    let paramIdx = 2;

    if (resourceType) {
      conditions.push(`resource_type = $${paramIdx++}`);
      params.push(resourceType);
    }
    if (action) {
      conditions.push(`action = $${paramIdx++}`);
      params.push(action);
    }

    params.push(safeLimit);
    const limitIdx = paramIdx++;
    params.push(safeOffset);
    const offsetIdx = paramIdx++;

    const sql = `
      SELECT id, workspace_id, actor_user_id, action, resource_type,
             resource_id, outcome, request_id, user_agent_summary, metadata, created_at
      FROM audit_logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const { rows } = client ? await client.query(sql, params) : await query(sql, params);
    return rows;
  }
}

module.exports = new AuditLogRepository();
