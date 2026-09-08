'use strict';

const axios = require('axios');
const crypto = require('crypto');
const tokenVault = require('./token-vault');
const facebookOAuthRepository = require('../repositories/facebook-oauth-repository');
const tenantPageRepository = require('../repositories/tenant-page-repository');
const { validateContent } = require('./content-safety');
const { publicError } = require('../security/public-error');

const FB_GRAPH_API_VERSION = 'v20.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${FB_GRAPH_API_VERSION}`;

// Facebook Graph API Error Codes
const NON_RETRYABLE_FB_CODES = new Set([
  190, // Invalid OAuth access token / expired / revoked
  200, // Permission error / user denied permission
  10,  // Application does not have permission
  368, // Blocked by Facebook for policy violations
  100  // Invalid parameter (unless temporary)
]);

const RETRYABLE_FB_CODES = new Set([
  1,   // An unknown error occurred on Facebook
  2,   // Service temporarily unavailable
  4,   // Application request limit reached
  17,  // User request limit reached
  32,  // Page request limit reached
  341, // Temporarily degraded service
  613  // Rate limit reached
]);

class PublishingClient {
  constructor() {
    this._customAdapter = null;
  }

  /**
   * Allows injecting a custom adapter for isolated unit/integration tests.
   */
  setAdapter(adapter) {
    this._customAdapter = adapter;
  }

  resetAdapter() {
    this._customAdapter = null;
  }

  /**
   * Classifies whether an error is retryable or should transition to dead-letter immediately.
   */
  classifyError(err) {
    if (err.isContentSafety) {
      return { isRetryable: false, code: 'CONTENT_SAFETY_VIOLATION' };
    }
    if (err.isAmbiguous) {
      return { isRetryable: true, code: 'AMBIGUOUS_PROVIDER_TIMEOUT' };
    }

    const fbCode = err.response?.data?.error?.code || err.fbCode;
    if (fbCode) {
      if (NON_RETRYABLE_FB_CODES.has(Number(fbCode))) {
        return { isRetryable: false, code: `FB_AUTH_OR_PERMISSION_${fbCode}` };
      }
      if (RETRYABLE_FB_CODES.has(Number(fbCode))) {
        return { isRetryable: true, code: `FB_RATE_OR_SERVER_${fbCode}` };
      }
    }

    const httpStatus = err.response?.status;
    if (httpStatus) {
      if (httpStatus === 401 || httpStatus === 403) {
        return { isRetryable: false, code: `HTTP_${httpStatus}_DENIED` };
      }
      if (httpStatus === 429 || httpStatus >= 500) {
        return { isRetryable: true, code: `HTTP_${httpStatus}_TRANSIENT` };
      }
    }

    const nodeCode = err.code;
    if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ESOCKETTIMEDOUT'].includes(nodeCode)) {
      return { isRetryable: true, code: `NETWORK_${nodeCode}` };
    }

    return { isRetryable: false, code: 'UNCLASSIFIED_ERROR' };
  }

  isAmbiguousError(err) {
    const nodeCode = err.code;
    const httpStatus = err.response?.status;
    return ['ETIMEDOUT', 'ECONNRESET', 'ESOCKETTIMEDOUT'].includes(nodeCode) ||
           httpStatus === 502 || httpStatus === 504;
  }

  /**
   * Reconciles whether a post was actually created on Facebook despite an ambiguous timeout.
   */
  async reconcileAmbiguousPublish({ pageId, accessToken, expectedCaption, sinceTimestamp }) {
    if (this._customAdapter && typeof this._customAdapter.reconcile === 'function') {
      return this._customAdapter.reconcile({ pageId, accessToken, expectedCaption, sinceTimestamp });
    }

    try {
      const url = `${GRAPH_BASE_URL}/${pageId}/feed`;
      const response = await axios.get(url, {
        params: {
          fields: 'id,message,created_time',
          limit: 10,
          access_token: accessToken
        },
        timeout: 10000
      });

      const posts = response.data?.data || [];
      const threshold = sinceTimestamp ? new Date(sinceTimestamp).getTime() - 60000 : Date.now() - 900000;

      for (const p of posts) {
        const postTime = new Date(p.created_time).getTime();
        if (postTime >= threshold && p.message && p.message.trim() === expectedCaption.trim()) {
          return {
            reconciled: true,
            fbPostId: p.id
          };
        }
      }
    } catch (reconcileErr) {
      // Reconcile lookup error; cannot confirm existence
    }

    return { reconciled: false };
  }

  /**
   * Publishes a post to Facebook using encrypted tokens from vault and content safety guard.
   */
  async publish({ workspaceId, workspacePageId, post, client = null }) {
    if (!post || !post.caption) {
      throw publicError('VALIDATION_FAILED', 'Post caption is required for publishing');
    }

    // 1. Content Safety Pre-flight Check
    const safetyCheck = validateContent({
      message: post.caption,
      imageUrl: Array.isArray(post.media_urls) && post.media_urls.length > 0 ? post.media_urls[0] : null
    }, { history: [], isAutoPilot: false });

    if (!safetyCheck.safe && safetyCheck.reasons.length > 0) {
      const err = new Error(`Content safety check failed: ${safetyCheck.reasons.join('; ')}`);
      err.isContentSafety = true;
      err.reasons = safetyCheck.reasons;
      throw err;
    }

    // 2. Fetch page and encrypted token
    let targetPage = null;
    if (workspacePageId) {
      const { rows } = await (client || require('../db/index')).query(
        'SELECT * FROM workspace_pages WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL',
        [workspaceId, workspacePageId]
      );
      targetPage = rows[0] || null;
    } else if (post.page_id) {
      targetPage = await tenantPageRepository.getPageById({ workspaceId, pageId: post.page_id }, client);
    }

    if (!targetPage) {
      const err = new Error('Authorized Facebook Page not found for this workspace.');
      err.code = 'PAGE_NOT_FOUND';
      throw err;
    }

    const tokenRow = await facebookOAuthRepository.getActiveToken({
      workspacePageId: targetPage.id
    }, client);

    if (!tokenRow || !tokenRow.token_encrypted) {
      const err = new Error('No active Facebook Page access token found. Please reconnect the page.');
      err.code = 'TOKEN_NOT_FOUND';
      throw err;
    }

    // 3. Decrypt token in-memory strictly for this call
    const accessToken = tokenVault.decrypt(tokenRow.token_encrypted, targetPage.id);

    // 4. Dispatch via Custom Adapter (for tests) or Graph API
    if (this._customAdapter && typeof this._customAdapter.publish === 'function') {
      return this._customAdapter.publish({
        workspaceId,
        workspacePageId: targetPage.id,
        pageId: targetPage.page_id,
        caption: post.caption,
        mediaUrls: post.media_urls || [],
        accessToken
      });
    }

    const startTime = Date.now();
    try {
      const endpoint = `${GRAPH_BASE_URL}/${targetPage.page_id}/feed`;
      const payload = {
        message: post.caption,
        access_token: accessToken
      };

      const res = await axios.post(endpoint, payload, { timeout: 25000 });
      const fbPostId = res.data?.id || res.data?.post_id;
      if (!fbPostId) {
        throw new Error('Graph API returned success without post ID');
      }

      return {
        success: true,
        fbPostId,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      if (this.isAmbiguousError(err)) {
        err.isAmbiguous = true;
      }
      // Sanitize any token from error message
      if (err.message) {
        err.message = err.message.replace(/access_token=\w+/g, 'access_token=[REDACTED]');
      }
      throw err;
    }
  }
}

module.exports = new PublishingClient();
