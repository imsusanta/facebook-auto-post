'use strict';

const crypto = require('crypto');
const { URLSearchParams } = require('url');
const tokenVault = require('./token-vault');
const facebookOAuthRepository = require('../repositories/facebook-oauth-repository');
const tenantPageRepository = require('../repositories/tenant-page-repository');
const { publicError } = require('../security/public-error');
const { withTransaction } = require('../db/index');

const GRAPH_API_VERSION = 'v20.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const REQUIRED_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_metadata'
];

/**
 * Returns Meta App configuration from environment variables.
 * Throws if not configured.
 */
function getAppConfig() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI;

  if (!appId || !appSecret || !redirectUri) {
    throw publicError('VALIDATION_FAILED', 'Meta App credentials are not configured');
  }

  return { appId, appSecret, redirectUri };
}

/**
 * Generates the Meta OAuth 2.0 authorization URL and stores a CSRF state.
 */
async function generateAuthUrl({ workspaceId, userId }) {
  const config = getAppConfig();

  // Generate cryptographic state
  const stateValue = crypto.randomBytes(32).toString('hex');

  // Store hashed state with 10-minute TTL
  await facebookOAuthRepository.createOAuthState({
    workspaceId,
    userId,
    stateValue,
    redirectUri: config.redirectUri
  });

  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    state: stateValue,
    scope: REQUIRED_SCOPES.join(','),
    response_type: 'code'
  });

  const authUrl = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;

  return { authUrl, state: stateValue };
}

/**
 * Handles the OAuth callback: validates state, exchanges code for tokens,
 * and fetches authorized pages.
 *
 * Returns the page list for user selection (tokens are NOT persisted yet).
 */
async function handleCallback({ code, state }) {
  if (!code || typeof code !== 'string') {
    throw publicError('OAUTH_STATE_INVALID', 'Authorization code is missing');
  }
  if (!state || typeof state !== 'string') {
    throw publicError('OAUTH_STATE_INVALID', 'OAuth state parameter is missing');
  }

  // 1. Consume and validate state
  const stateRow = await facebookOAuthRepository.consumeOAuthState({ stateValue: state });
  if (!stateRow) {
    throw publicError('OAUTH_STATE_INVALID', 'OAuth state is invalid, expired, or already consumed');
  }

  const config = getAppConfig();

  // 2. Exchange code for short-lived user access token
  let shortLivedToken;
  try {
    const axios = require('axios');
    const tokenRes = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: {
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: config.redirectUri,
        code
      },
      timeout: 15000
    });
    shortLivedToken = tokenRes.data.access_token;
    if (!shortLivedToken) {
      throw new Error('No access_token in response');
    }
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw publicError('OAUTH_EXCHANGE_FAILED', `Token exchange failed: ${msg}`);
  }

  // 3. Exchange for long-lived token (60 days)
  let longLivedToken;
  let tokenExpiresIn;
  try {
    const axios = require('axios');
    const llRes = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: shortLivedToken
      },
      timeout: 15000
    });
    longLivedToken = llRes.data.access_token;
    tokenExpiresIn = llRes.data.expires_in; // seconds
  } catch {
    // If long-lived exchange fails, fall back to short-lived token
    longLivedToken = shortLivedToken;
    tokenExpiresIn = 3600;
  }

  // 4. Fetch authorized pages
  let pages = [];
  try {
    const axios = require('axios');
    const pagesRes = await axios.get(`${GRAPH_BASE}/me/accounts`, {
      params: {
        fields: 'id,name,access_token,category,picture{url}',
        access_token: longLivedToken
      },
      timeout: 15000
    });
    pages = (pagesRes.data.data || []).map(p => ({
      pageId: p.id,
      pageName: p.name,
      pageAccessToken: p.access_token,
      category: p.category || 'General',
      pictureUrl: p.picture?.data?.url || null
    }));
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw publicError('META_API_ERROR', `Failed to fetch pages: ${msg}`);
  }

  return {
    workspaceId: stateRow.workspace_id,
    userId: stateRow.user_id,
    longLivedUserToken: longLivedToken,
    tokenExpiresIn,
    pages
  };
}

/**
 * Connects selected pages to a workspace, encrypting and storing their tokens.
 */
async function connectSelectedPages({
  workspaceId, userId, selectedPages, longLivedUserToken, requestId = null
}) {
  if (!Array.isArray(selectedPages) || selectedPages.length === 0) {
    throw publicError('VALIDATION_FAILED', 'At least one page must be selected');
  }

  const connected = [];

  await withTransaction(async (client) => {
    for (const page of selectedPages) {
      if (!page.pageId || !page.pageName || !page.pageAccessToken) {
        throw publicError('VALIDATION_FAILED', 'Each page must have pageId, pageName, and pageAccessToken');
      }

      // 1. Upsert page in workspace_pages
      const connectedPage = await tenantPageRepository.connectPage({
        workspaceId,
        pageId: page.pageId,
        pageName: page.pageName,
        category: page.category || 'General',
        systemPrompt: null,
        isDefault: selectedPages.indexOf(page) === 0 && connected.length === 0,
        actorUserId: userId,
        requestId
      }, client);

      // 2. Encrypt and store page access token
      const tokenEncrypted = tokenVault.encrypt(page.pageAccessToken, connectedPage.id);
      await facebookOAuthRepository.storePageToken({
        workspaceId,
        workspacePageId: connectedPage.id,
        tokenEncrypted,
        tokenType: 'page_access_token',
        scopes: REQUIRED_SCOPES,
        expiresAt: null, // Page tokens from long-lived exchange don't expire
        actorUserId: userId,
        requestId
      }, client);

      // 3. Store user access token (for future page-token refresh)
      if (longLivedUserToken) {
        const userTokenEncrypted = tokenVault.encrypt(longLivedUserToken, connectedPage.id + ':user');
        await facebookOAuthRepository.storePageToken({
          workspaceId,
          workspacePageId: connectedPage.id,
          tokenEncrypted: userTokenEncrypted,
          tokenType: 'user_access_token',
          scopes: REQUIRED_SCOPES,
          expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000), // 60 days
          actorUserId: userId,
          requestId
        }, client);
      }

      // 4. Register webhook subscription for the page
      await facebookOAuthRepository.registerWebhookSubscription({
        workspaceId,
        pageId: page.pageId
      }, client);

      connected.push({
        id: connectedPage.id,
        pageId: connectedPage.page_id,
        pageName: connectedPage.page_name,
        status: connectedPage.status,
        isDefault: connectedPage.is_default
      });
    }
  });

  return connected;
}

/**
 * Disconnects a page: revokes tokens, removes webhook subscription, soft-deletes page.
 */
async function disconnectPage({ workspaceId, pageId, userId, requestId = null }) {
  if (!workspaceId || !pageId) {
    throw publicError('VALIDATION_FAILED', 'workspaceId and pageId are required');
  }

  // Look up the workspace_page record to get its UUID
  const page = await tenantPageRepository.getPageById({ workspaceId, pageId });
  if (!page) {
    throw publicError('RESOURCE_NOT_FOUND', 'Page not found in workspace');
  }

  await withTransaction(async (client) => {
    // 1. Revoke all tokens
    await facebookOAuthRepository.revokeTokens({
      workspacePageId: page.id,
      actorUserId: userId,
      requestId
    }, client);

    // 2. Remove webhook subscription
    await facebookOAuthRepository.removeWebhookSubscription({
      workspaceId,
      pageId
    }, client);

    // 3. Soft-delete the page
    await tenantPageRepository.disconnectPage({
      workspaceId,
      pageId,
      actorUserId: userId,
      requestId
    }, client);
  });

  return { pageId, disconnected: true };
}

/**
 * Retrieves the decrypted page access token for Graph API use.
 * Never exposes the plaintext in HTTP responses.
 */
async function getDecryptedPageToken({ workspacePageId }) {
  const tokenRow = await facebookOAuthRepository.getActiveToken({
    workspacePageId,
    tokenType: 'page_access_token'
  });

  if (!tokenRow) {
    throw publicError('TOKEN_EXPIRED', 'No active token found for this page');
  }

  if (tokenRow.expires_at && new Date(tokenRow.expires_at) <= new Date()) {
    throw publicError('TOKEN_EXPIRED', 'Page access token has expired');
  }

  try {
    return tokenVault.decrypt(tokenRow.token_encrypted, workspacePageId);
  } catch {
    throw publicError('TOKEN_EXPIRED', 'Token decryption failed');
  }
}

/**
 * Returns connection status for all pages in a workspace (no tokens exposed).
 */
async function getConnectionStatus({ workspaceId }) {
  const tokenStatuses = await facebookOAuthRepository.listTokenStatus({ workspaceId });

  return tokenStatuses.map(t => ({
    workspacePageId: t.workspace_page_id,
    pageId: t.page_id,
    pageName: t.page_name,
    pageStatus: t.page_status,
    tokenType: t.token_type,
    scopes: t.scopes,
    issuedAt: t.issued_at,
    expiresAt: t.expires_at,
    isRevoked: !!t.revoked_at,
    isExpired: t.expires_at ? new Date(t.expires_at) <= new Date() : false
  }));
}

/**
 * Verifies Graph API connectivity for a connected page using its stored token.
 */
async function testPageConnection({ workspaceId, pageId }) {
  const page = await tenantPageRepository.getPageById({ workspaceId, pageId });
  if (!page) {
    throw publicError('RESOURCE_NOT_FOUND', 'Page not found in workspace');
  }

  const plainToken = await getDecryptedPageToken({ workspacePageId: page.id });

  try {
    const axios = require('axios');
    const res = await axios.get(`${GRAPH_BASE}/${pageId}`, {
      params: {
        fields: 'id,name,category',
        access_token: plainToken
      },
      timeout: 10000
    });

    return {
      connected: true,
      pageId: res.data.id,
      pageName: res.data.name,
      category: res.data.category
    };
  } catch (err) {
    const fbError = err.response?.data?.error;
    throw publicError('META_API_ERROR', fbError?.message || 'Graph API connection test failed');
  }
}

module.exports = {
  generateAuthUrl,
  handleCallback,
  connectSelectedPages,
  disconnectPage,
  getDecryptedPageToken,
  getConnectionStatus,
  testPageConnection,
  REQUIRED_SCOPES
};
