# Gate 4: Facebook / Meta OAuth Integration & Token Vault

## Architecture Overview

This document specifies the implementation of **Gate 4: Meta Connection & Token Vault** in the SaaS architecture.

```
┌─────────────────┐       OAuth 2.0        ┌──────────────────┐
│  Customer / UI  │ ─────────────────────> │  Meta OAuth      │
│                 │ <───────────────────── │  (Graph API v20) │
└────────┬────────┘      Code + State      └────────┬─────────┘
         │                                          │
         │ GET /facebook/callback                   │ Exchange for Short + Long-Lived
         v                                          v
┌─────────────────┐   AES-256-GCM (AAD)    ┌──────────────────┐
│ FacebookOAuth   │ ─────────────────────> │ workspace_page_  │
│ Service         │   Bound to Page UUID   │ tokens (DB)      │
└────────┬────────┘                        └──────────────────┘
         │
         │ Webhook Routing
         v
┌─────────────────────────────┐
│  workspace_webhook_         │  Route by page_id → workspace_id
│  subscriptions / events     │  Deduplicate by (page_id, event_id)
└─────────────────────────────┘
```

---

## 1. Meta OAuth 2.0 Flow

### 1.1 Authorization Request
- Endpoint: `GET /api/v1/workspaces/:workspaceId/facebook/auth`
- RBAC Permission: `facebook:connect` (`owner`, `admin`)
- Generates a 32-byte cryptographic `state` value.
- Hashes `state` using SHA-256 and stores in `workspace_oauth_states` with a 10-minute TTL.
- Returns the Meta OAuth dialog URL:
  ```
  https://www.facebook.com/v20.0/dialog/oauth?
    client_id=<APP_ID>&
    redirect_uri=<REDIRECT_URI>&
    state=<STATE_VALUE>&
    scope=pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata&
    response_type=code
  ```

### 1.2 Callback & Token Exchange
- Endpoint: `GET /api/v1/workspaces/:workspaceId/facebook/callback`
- Atomic single-use state consumption: `UPDATE workspace_oauth_states SET consumed_at = NOW() WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()`
- Code exchanged for short-lived user access token (`GET /oauth/access_token`).
- Short-lived token exchanged for 60-day long-lived user access token (`grant_type=fb_exchange_token`).
- Fetches authorized pages via `GET /me/accounts?fields=id,name,access_token,category,picture{url}`.
- Returns list of authorized pages to customer for selection (tokens NOT persisted yet).

### 1.3 Page Connection & Token Vaulting
- Endpoint: `POST /api/v1/workspaces/:workspaceId/facebook/connect`
- For each selected page:
  1. Upsert into `workspace_pages` table (`UNIQUE (workspace_id, page_id)`).
  2. Encrypt page access token via AES-256-GCM using `FB_TOKEN_ENCRYPTION_KEY`.
  3. Additional Authenticated Data (AAD) is bound to the `workspace_page_id` UUID to prevent cross-row ciphertext relocation.
  4. Store encrypted envelope (`v`, `iv`, `tag`, `body`) in `workspace_page_tokens`.
  5. Store long-lived user access token for future page token background refresh.
  6. Register webhook subscription in `workspace_webhook_subscriptions`.
  7. Audit log `token:stored` event.

---

## 2. Token Vault Security Invariants

1. **AES-256-GCM with AAD Binding**:
   - Every token is encrypted with an ephemeral 12-byte IV and authenticated with a 16-byte GCM tag.
   - The AAD is set to the page's UUID (`workspace_page_id`), binding the ciphertext cryptographically to that database row. Relocating a ciphertext to another row causes decryption failure.
2. **Key Separation**:
   - Dedicated 32-byte (64 hex characters) key sourced from `FB_TOKEN_ENCRYPTION_KEY`.
   - Separate from account mail encryption keys (`AUTH_MAIL_ENCRYPTION_KEY`).
3. **Zero Plaintext at Rest & in Transit**:
   - Plaintext `EAA...` tokens are never stored in the database.
   - Plaintext tokens are never reflected in API responses, server logs, or error diagnostics.
   - Only decrypted on-demand inside `getDecryptedPageToken()` immediately prior to Graph API dispatch.
4. **Token Revocation & Expiry**:
   - When a page is re-connected or disconnected, all prior active tokens are marked `revoked_at = NOW()`.
   - Expired tokens fail closed with `TOKEN_EXPIRED (401)`.

---

## 3. Webhook Architecture & Routing

### 3.1 Tenant Routing
- Meta webhooks arrive at `POST /api/webhook/facebook`.
- Existing byte-exact HMAC-SHA256 signature verification (`X-Hub-Signature-256`) is enforced first.
- The webhook payload contains `entry[].id` (Facebook Page ID).
- In PostgreSQL mode, the handler queries `workspace_webhook_subscriptions` to resolve `page_id → workspace_id`.
- If found, the event is processed within that workspace's tenant context.
- Unregistered page IDs are acknowledged with `200 EVENT_RECEIVED` and safely discarded (never crash).

### 3.2 Event Deduplication
- Facebook guarantees at-least-once webhook delivery, meaning duplicate events occur during network hiccups.
- Events are recorded in `workspace_webhook_events` with `UNIQUE (page_id, event_id)`.
- If an insert encounters a conflict (`DO NOTHING`), the event is identified as a duplicate and processing is skipped.

---

## 4. Disconnection & Revocation Lifecycle

- Endpoint: `POST /api/v1/workspaces/:workspaceId/facebook/disconnect/:pageId`
- RBAC Permission: `facebook:disconnect` (`owner`, `admin`)
- Operations (executed atomically in a transaction):
  1. Revoke active tokens in `workspace_page_tokens` (`revoked_at = NOW()`).
  2. Mark webhook subscription as `removed` in `workspace_webhook_subscriptions`.
  3. Soft-delete the page in `workspace_pages` (`deleted_at = NOW()`).
  4. Record `page:disconnected` and `token:revoked` audit log entries.

---

## 5. RBAC Permission Mapping

| Permission | Description | Owner | Admin | Reviewer | Editor | Viewer |
|---|---|:---:|:---:|:---:|:---:|:---:|
| `facebook:connect` | Initiate OAuth & connect pages | Yes | Yes | No | No | No |
| `facebook:disconnect` | Disconnect page & revoke tokens | Yes | Yes | No | No | No |
| `facebook:status` | View page connection & token status | Yes | Yes | Yes | No | No |

---

## 6. Required Environment Variables

| Variable | Type | Description |
|---|---|---|
| `FB_TOKEN_ENCRYPTION_KEY` | 64-hex string | 32-byte key for AES-256-GCM token encryption |
| `META_APP_ID` | String | Meta Developer App ID |
| `META_APP_SECRET` | String | Meta Developer App Secret |
| `META_OAUTH_REDIRECT_URI` | URL | Authorized OAuth redirect URI |
| `FB_VERIFY_TOKEN` | String | Webhook challenge verification token |
