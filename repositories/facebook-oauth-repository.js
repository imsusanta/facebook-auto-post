'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const { publicError } = require('../security/public-error');
const auditLogRepository = require('./audit-log-repository');

class FacebookOAuthRepository {

  // --- OAuth State Management ---

  /**
   * Creates a single-use OAuth state entry with a 10-minute TTL.
   * The state value itself is hashed (SHA-256) before storage.
   */
  async createOAuthState({ workspaceId, userId, stateValue, redirectUri }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) throw publicError('VALIDATION_FAILED', 'Invalid workspaceId');
    if (!isValidUuid(userId)) throw publicError('VALIDATION_FAILED', 'Invalid userId');
    if (!stateValue || typeof stateValue !== 'string') throw publicError('VALIDATION_FAILED', 'State value is required');
    if (!redirectUri || typeof redirectUri !== 'string') throw publicError('VALIDATION_FAILED', 'Redirect URI is required');

    const stateHash = crypto.createHash('sha256').update(stateValue).digest('hex');
    const id = generateUuid();

    const sql = `
      INSERT INTO workspace_oauth_states (id, workspace_id, user_id, state_hash, redirect_uri, expires_at)
      VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '10 minutes')
      RETURNING id, workspace_id, user_id, state_hash, redirect_uri, created_at, expires_at;
    `;

    const exec = clientOverride || { query: (text, params) => query(text, params) };
    const { rows } = await exec.query(sql, [id, workspaceId, userId, stateHash, redirectUri]);
    return rows[0];
  }

  /**
   * Atomically consumes a pending OAuth state.
   * Returns the state row if valid; null if expired, already consumed, or not found.
   */
  async consumeOAuthState({ stateValue }, clientOverride = null) {
    if (!stateValue || typeof stateValue !== 'string') return null;

    const stateHash = crypto.createHash('sha256').update(stateValue).digest('hex');

    const executeInTx = async (client) => {
      const sql = `
        UPDATE workspace_oauth_states
        SET consumed_at = NOW()
        WHERE state_hash = $1
          AND consumed_at IS NULL
          AND expires_at > NOW()
        RETURNING id, workspace_id, user_id, redirect_uri;
      `;
      const { rows } = await client.query(sql, [stateHash]);
      return rows[0] || null;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  // --- Token Storage ---

  /**
   * Stores an encrypted page token, revoking any prior active token of the same type.
   */
  async storePageToken({
    workspaceId,
    workspacePageId,
    tokenEncrypted,
    tokenType = 'page_access_token',
    scopes = [],
    expiresAt = null,
    actorUserId = null,
    requestId = null
  }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) throw publicError('VALIDATION_FAILED', 'Invalid workspaceId');
    if (!isValidUuid(workspacePageId)) throw publicError('VALIDATION_FAILED', 'Invalid workspacePageId');
    if (!tokenEncrypted || typeof tokenEncrypted !== 'string') {
      throw publicError('VALIDATION_FAILED', 'Encrypted token is required');
    }

    const executeInTx = async (client) => {
      // Revoke prior active tokens of same type for this page
      await client.query(
        `UPDATE workspace_page_tokens
         SET revoked_at = NOW(), updated_at = NOW()
         WHERE workspace_page_id = $1 AND token_type = $2 AND revoked_at IS NULL`,
        [workspacePageId, tokenType]
      );

      const id = generateUuid();
      const insertSql = `
        INSERT INTO workspace_page_tokens (
          id, workspace_id, workspace_page_id, token_encrypted,
          token_type, scopes, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, workspace_id, workspace_page_id, token_type, scopes,
                  issued_at, expires_at, revoked_at, created_at;
      `;
      const { rows } = await client.query(insertSql, [
        id, workspaceId, workspacePageId, tokenEncrypted,
        tokenType, scopes, expiresAt || null
      ]);

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'token:stored',
        resourceType: 'page_token',
        resourceId: workspacePageId,
        requestId,
        metadata: { tokenType, hasExpiry: !!expiresAt }
      }, client);

      return rows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Returns the active encrypted token for a workspace page (without decrypting).
   */
  async getActiveToken({ workspacePageId, tokenType = 'page_access_token' }, client = null) {
    if (!isValidUuid(workspacePageId)) return null;

    const sql = `
      SELECT id, workspace_id, workspace_page_id, token_encrypted, token_type,
             scopes, issued_at, expires_at
      FROM workspace_page_tokens
      WHERE workspace_page_id = $1
        AND token_type = $2
        AND revoked_at IS NULL
      ORDER BY issued_at DESC
      LIMIT 1;
    `;
    const exec = client || { query: (text, params) => query(text, params) };
    const { rows } = await exec.query(sql, [workspacePageId, tokenType]);
    return rows[0] || null;
  }

  /**
   * Revokes all active tokens for a workspace page.
   */
  async revokeTokens({ workspacePageId, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspacePageId)) throw publicError('VALIDATION_FAILED', 'Invalid workspacePageId');

    const executeInTx = async (client) => {
      const sql = `
        UPDATE workspace_page_tokens
        SET revoked_at = NOW(), updated_at = NOW()
        WHERE workspace_page_id = $1 AND revoked_at IS NULL
        RETURNING id, workspace_id, token_type;
      `;
      const { rows } = await client.query(sql, [workspacePageId]);

      if (rows.length > 0) {
        await auditLogRepository.recordEvent({
          workspaceId: rows[0].workspace_id,
          actorUserId,
          action: 'token:revoked',
          resourceType: 'page_token',
          resourceId: workspacePageId,
          requestId,
          metadata: { revokedCount: rows.length }
        }, client);
      }

      return rows;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Lists token status per workspace page (no ciphertext returned).
   */
  async listTokenStatus({ workspaceId }, client = null) {
    if (!isValidUuid(workspaceId)) return [];

    const sql = `
      SELECT wpt.id, wpt.workspace_page_id, wpt.token_type, wpt.scopes,
             wpt.issued_at, wpt.expires_at, wpt.revoked_at,
             wp.page_id, wp.page_name, wp.status AS page_status
      FROM workspace_page_tokens wpt
      JOIN workspace_pages wp ON wpt.workspace_page_id = wp.id
      WHERE wpt.workspace_id = $1
      ORDER BY wpt.created_at DESC;
    `;
    const exec = client || { query: (text, params) => query(text, params) };
    const { rows } = await exec.query(sql, [workspaceId]);
    return rows;
  }

  // --- Webhook Subscriptions ---

  async registerWebhookSubscription({ workspaceId, pageId, subscriptionId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) throw publicError('VALIDATION_FAILED', 'Invalid workspaceId');
    if (!pageId || typeof pageId !== 'string') throw publicError('VALIDATION_FAILED', 'Page ID is required');

    const id = generateUuid();
    const sql = `
      INSERT INTO workspace_webhook_subscriptions (id, workspace_id, page_id, subscription_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (workspace_id, page_id) DO UPDATE SET
        subscription_id = COALESCE(EXCLUDED.subscription_id, workspace_webhook_subscriptions.subscription_id),
        status = 'active',
        updated_at = NOW()
      RETURNING id, workspace_id, page_id, subscription_id, status;
    `;
    const exec = clientOverride || { query: (text, params) => query(text, params) };
    const { rows } = await exec.query(sql, [id, workspaceId, pageId, subscriptionId || null]);
    return rows[0];
  }

  /**
   * Resolves a Facebook page_id to the owning workspace_id for webhook routing.
   */
  async findWorkspaceByPageId({ pageId }, client = null) {
    if (!pageId) return null;

    const sql = `
      SELECT workspace_id, page_id, status
      FROM workspace_webhook_subscriptions
      WHERE page_id = $1 AND status = 'active'
      LIMIT 1;
    `;
    const exec = client || { query: (text, params) => query(text, params) };
    const { rows } = await exec.query(sql, [String(pageId)]);
    return rows[0] || null;
  }

  async removeWebhookSubscription({ workspaceId, pageId }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !pageId) return null;

    const sql = `
      UPDATE workspace_webhook_subscriptions
      SET status = 'removed', updated_at = NOW()
      WHERE workspace_id = $1 AND page_id = $2 AND status = 'active'
      RETURNING id, workspace_id, page_id;
    `;
    const exec = clientOverride || { query: (text, params) => query(text, params) };
    const { rows } = await exec.query(sql, [workspaceId, String(pageId)]);
    return rows[0] || null;
  }

  // --- Webhook Event Deduplication ---

  /**
   * Attempts to record a webhook event. Returns true if new, false if duplicate.
   */
  async recordWebhookEvent({ workspaceId, pageId, eventType, eventId }, client = null) {
    if (!isValidUuid(workspaceId) || !pageId || !eventId) return false;

    const id = generateUuid();
    const sql = `
      INSERT INTO workspace_webhook_events (id, workspace_id, page_id, event_type, event_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (page_id, event_id) DO NOTHING
      RETURNING id;
    `;
    const exec = client || { query: (text, params) => query(text, params) };
    const { rows } = await exec.query(sql, [id, workspaceId, String(pageId), eventType, String(eventId)]);
    return rows.length > 0;
  }
}

module.exports = new FacebookOAuthRepository();
