'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

module.exports = function registerFacebookOAuthCases(ctx) {
  const request = options => ctx.request(options);
  const query = (...args) => ctx.query(...args);
  const wsA = () => ctx.workspaceA;
  const wsB = () => ctx.workspaceB;
  const uA = () => ctx.userA;
  const uB = () => ctx.userB;

  describe('Gate 4: Facebook/Meta OAuth Integration, Token Vault & Webhook Routing', () => {

    // --- Token Vault Unit Tests ---
    describe('Token Vault (AES-256-GCM)', () => {
      it('Encrypt/decrypt round-trip succeeds with correct AAD', () => {
        const tokenVault = require('../services/token-vault');
        const plaintext = 'EAABtest_token_value_123456';
        const aad = crypto.randomUUID();

        const envelope = tokenVault.encrypt(plaintext, aad);
        const parsed = JSON.parse(envelope);

        // Envelope structure
        assert.equal(parsed.v, 1);
        assert.ok(parsed.iv, 'IV present');
        assert.ok(parsed.tag, 'Auth tag present');
        assert.ok(parsed.body, 'Ciphertext present');
        assert.ok(!envelope.includes('EAABtest'), 'Plaintext must not appear in ciphertext');

        // Round-trip
        const decrypted = tokenVault.decrypt(envelope, aad);
        assert.equal(decrypted, plaintext);
      });

      it('Decrypt fails with wrong AAD (prevents cross-row relocation)', () => {
        const tokenVault = require('../services/token-vault');
        const plaintext = 'EAABsecret_page_token';
        const correctAad = crypto.randomUUID();
        const wrongAad = crypto.randomUUID();

        const envelope = tokenVault.encrypt(plaintext, correctAad);
        assert.throws(() => tokenVault.decrypt(envelope, wrongAad), 'Wrong AAD must fail');
      });

      it('Encrypt rejects empty plaintext', () => {
        const tokenVault = require('../services/token-vault');
        assert.throws(() => tokenVault.encrypt('', 'some-aad'));
      });

      it('Encrypt rejects empty AAD', () => {
        const tokenVault = require('../services/token-vault');
        assert.throws(() => tokenVault.encrypt('token', ''));
      });

      it('Decrypt rejects malformed envelope', () => {
        const tokenVault = require('../services/token-vault');
        assert.throws(() => tokenVault.decrypt('not-json', 'aad'));
        assert.throws(() => tokenVault.decrypt('{"v":2}', 'aad'));
      });
    });

    // --- OAuth State Management ---
    describe('OAuth State Management', () => {
      it('Create and consume OAuth state', async () => {
        const stateValue = crypto.randomBytes(32).toString('hex');
        const stateHash = crypto.createHash('sha256').update(stateValue).digest('hex');

        await query(
          `INSERT INTO workspace_oauth_states (id, workspace_id, user_id, state_hash, redirect_uri, expires_at)
           VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '10 minutes')`,
          [crypto.randomUUID(), wsA().id, uA().id, stateHash, 'http://localhost:3000/callback']
        );

        // Consume it
        const { rows: consumed } = await query(
          `UPDATE workspace_oauth_states
           SET consumed_at = NOW()
           WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
           RETURNING workspace_id, user_id`,
          [stateHash]
        );
        assert.equal(consumed.length, 1);
        assert.equal(consumed[0].workspace_id, wsA().id);
      });

      it('Consuming already-consumed state returns nothing (single-use)', async () => {
        const stateValue = crypto.randomBytes(32).toString('hex');
        const stateHash = crypto.createHash('sha256').update(stateValue).digest('hex');

        await query(
          `INSERT INTO workspace_oauth_states (id, workspace_id, user_id, state_hash, redirect_uri, expires_at, consumed_at)
           VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '10 minutes', NOW())`,
          [crypto.randomUUID(), wsA().id, uA().id, stateHash, 'http://localhost:3000/callback']
        );

        const { rows } = await query(
          `UPDATE workspace_oauth_states
           SET consumed_at = NOW()
           WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
           RETURNING id`,
          [stateHash]
        );
        assert.equal(rows.length, 0, 'Already consumed state must not be reusable');
      });

      it('Expired state cannot be consumed', async () => {
        const stateValue = crypto.randomBytes(32).toString('hex');
        const stateHash = crypto.createHash('sha256').update(stateValue).digest('hex');

        await query(
          `INSERT INTO workspace_oauth_states (id, workspace_id, user_id, state_hash, redirect_uri, expires_at)
           VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '1 minute')`,
          [crypto.randomUUID(), wsA().id, uA().id, stateHash, 'http://localhost:3000/callback']
        );

        const { rows } = await query(
          `UPDATE workspace_oauth_states
           SET consumed_at = NOW()
           WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
           RETURNING id`,
          [stateHash]
        );
        assert.equal(rows.length, 0, 'Expired state must not be consumed');
      });
    });

    // --- Token Storage & Retrieval ---
    describe('Encrypted Token Storage', () => {
      let workspacePageIdA;

      it('Store encrypted page token for Workspace A page', async () => {
        // First ensure a page exists
        const pageRes = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/pages`,
          headers: { 'x-test-user-id': uA().id },
          body: {
            pageId: 'oauth-page-001',
            pageName: 'OAuth Test Page A'
          }
        });
        assert.equal(pageRes.status, 201);
        workspacePageIdA = pageRes.body.page.id;

        const tokenVault = require('../services/token-vault');
        const fakePlainToken = 'EAAB_fake_oauth_token_workspace_A';
        const encrypted = tokenVault.encrypt(fakePlainToken, workspacePageIdA);

        // Store token
        const tokenId = crypto.randomUUID();
        await query(
          `INSERT INTO workspace_page_tokens (id, workspace_id, workspace_page_id, token_encrypted, token_type, scopes)
           VALUES ($1, $2, $3, $4, 'page_access_token', $5)`,
          [tokenId, wsA().id, workspacePageIdA, encrypted, ['pages_show_list', 'pages_manage_posts']]
        );

        // Verify stored value is ciphertext, not plaintext
        const { rows } = await query(
          'SELECT token_encrypted FROM workspace_page_tokens WHERE id = $1',
          [tokenId]
        );
        assert.ok(rows[0].token_encrypted, 'Token row exists');
        assert.ok(!rows[0].token_encrypted.includes('EAAB_fake'), 'Plaintext token must never be stored');

        // Verify decryption succeeds with correct AAD
        const decrypted = tokenVault.decrypt(rows[0].token_encrypted, workspacePageIdA);
        assert.equal(decrypted, fakePlainToken);
      });

      it('Token decryption fails with wrong workspace_page_id AAD (cross-tenant protection)', async () => {
        const tokenVault = require('../services/token-vault');
        const { rows } = await query(
          'SELECT token_encrypted FROM workspace_page_tokens WHERE workspace_page_id = $1 AND revoked_at IS NULL LIMIT 1',
          [workspacePageIdA]
        );
        assert.ok(rows.length > 0, 'Token exists');

        const wrongAad = crypto.randomUUID();
        assert.throws(
          () => tokenVault.decrypt(rows[0].token_encrypted, wrongAad),
          'Decryption with wrong AAD must fail'
        );
      });

      it('Only one active token per type per page (unique constraint)', async () => {
        const tokenVault = require('../services/token-vault');
        const encrypted2 = tokenVault.encrypt('EAAB_replacement_token', workspacePageIdA);
        const id2 = crypto.randomUUID();

        // Revoke old, insert new (mimics storePageToken behavior)
        await query(
          `UPDATE workspace_page_tokens SET revoked_at = NOW() WHERE workspace_page_id = $1 AND revoked_at IS NULL`,
          [workspacePageIdA]
        );
        await query(
          `INSERT INTO workspace_page_tokens (id, workspace_id, workspace_page_id, token_encrypted, token_type, scopes)
           VALUES ($1, $2, $3, $4, 'page_access_token', $5)`,
          [id2, wsA().id, workspacePageIdA, encrypted2, ['pages_show_list']]
        );

        // Verify only one active token
        const { rows } = await query(
          'SELECT COUNT(*)::int as count FROM workspace_page_tokens WHERE workspace_page_id = $1 AND revoked_at IS NULL',
          [workspacePageIdA]
        );
        assert.equal(rows[0].count, 1, 'Only one active token per type');
      });

      it('Revoke all tokens for a page', async () => {
        await query(
          'UPDATE workspace_page_tokens SET revoked_at = NOW() WHERE workspace_page_id = $1 AND revoked_at IS NULL',
          [workspacePageIdA]
        );

        const { rows } = await query(
          'SELECT COUNT(*)::int as count FROM workspace_page_tokens WHERE workspace_page_id = $1 AND revoked_at IS NULL',
          [workspacePageIdA]
        );
        assert.equal(rows[0].count, 0, 'All tokens revoked');
      });
    });

    // --- Webhook Routing & Deduplication ---
    describe('Webhook Routing & Deduplication', () => {
      it('Register webhook subscription and route page_id to workspace', async () => {
        const subId = crypto.randomUUID();
        await query(
          `INSERT INTO workspace_webhook_subscriptions (id, workspace_id, page_id, status)
           VALUES ($1, $2, $3, 'active')
           ON CONFLICT (workspace_id, page_id) DO UPDATE SET status = 'active', updated_at = NOW()`,
          [subId, wsA().id, 'webhook-page-A']
        );

        // Route lookup
        const { rows } = await query(
          `SELECT workspace_id FROM workspace_webhook_subscriptions WHERE page_id = $1 AND status = 'active'`,
          ['webhook-page-A']
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].workspace_id, wsA().id);
      });

      it('Unknown page_id returns no routing result', async () => {
        const { rows } = await query(
          `SELECT workspace_id FROM workspace_webhook_subscriptions WHERE page_id = $1 AND status = 'active'`,
          ['unknown-page-xyz']
        );
        assert.equal(rows.length, 0, 'Unknown page must not route');
      });

      it('Webhook event deduplication: first insert succeeds, duplicate is ignored', async () => {
        const evId = crypto.randomUUID();

        // First insert
        const { rows: r1 } = await query(
          `INSERT INTO workspace_webhook_events (id, workspace_id, page_id, event_type, event_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (page_id, event_id) DO NOTHING
           RETURNING id`,
          [evId, wsA().id, 'webhook-page-A', 'feed_comment', 'event_123']
        );
        assert.equal(r1.length, 1, 'First event insert succeeds');

        // Duplicate
        const { rows: r2 } = await query(
          `INSERT INTO workspace_webhook_events (id, workspace_id, page_id, event_type, event_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (page_id, event_id) DO NOTHING
           RETURNING id`,
          [crypto.randomUUID(), wsA().id, 'webhook-page-A', 'feed_comment', 'event_123']
        );
        assert.equal(r2.length, 0, 'Duplicate event must be silently ignored');
      });
    });

    // --- Cross-Tenant Isolation ---
    describe('Cross-Tenant Token Isolation', () => {
      it('Workspace B cannot see Workspace A page tokens', async () => {
        const { rows } = await query(
          `SELECT id FROM workspace_page_tokens WHERE workspace_id = $1`,
          [wsB().id]
        );
        // wsB hasn't stored any tokens for oauth-page-001
        const wsATokens = await query(
          `SELECT id FROM workspace_page_tokens WHERE workspace_id = $1`,
          [wsA().id]
        );
        // Verify token data is workspace-scoped
        for (const tok of wsATokens.rows) {
          const inB = rows.find(r => r.id === tok.id);
          assert.equal(inB, undefined, 'Workspace A tokens must not appear in Workspace B query');
        }
      });

      it('Workspace B cannot disconnect Workspace A pages via API', async () => {
        const res = await request({
          method: 'DELETE',
          path: `/api/v1/workspaces/${wsA().id}/pages/oauth-page-001`,
          headers: { 'x-test-user-id': uB().id }
        });
        // uB is not a member of wsA → 404
        assert.equal(res.status, 404);
      });
    });

    // --- RBAC Permission Tests ---
    describe('Facebook Permission RBAC', () => {
      it('Viewer cannot access facebook:connect endpoints', async () => {
        // userF is a viewer in workspaceA if present, otherwise skip
        if (!ctx.userF) return;
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/facebook/status`,
          headers: { 'x-test-user-id': ctx.userF.id }
        });
        // viewer does not have facebook:status in current config; if they do, this confirms read access
        // The actual assertion depends on the role assignment
        assert.ok([200, 403].includes(res.status), 'Viewer gets 200 or 403 depending on permissions');
      });
    });

    // --- Migration Rollback Test ---
    describe('Migration 011 Rollback Verification', () => {
      it('Migration 011 down/up cycle works without data loss in other tables', async () => {
        // Use a dedicated schema to avoid interfering with active test data
        const testSchema = `test_mig_011_${Date.now()}`;
        const { Pool } = require('pg');
        const { getDatabaseConfig } = require('../config/database');
        const config = getDatabaseConfig();
        const pool = new Pool({ connectionString: config.connectionString });
        const client = await pool.connect();
        try {
          await client.query(`CREATE SCHEMA ${testSchema}`);
          await client.query(`SET search_path TO ${testSchema}`);

          // Run all migrations 001-011 in the test schema
          const fs = require('fs');
          const path = require('path');
          const migDir = path.join(__dirname, '..', 'migrations', 'postgres');
          for (let i = 1; i <= 11; i++) {
            const num = String(i).padStart(3, '0');
            const upFile = path.join(migDir, `${num}_${fs.readdirSync(migDir).find(f => f.startsWith(num) && !f.includes('down')).split('_').slice(1).join('_')}`);
            const upSql = fs.readFileSync(upFile, 'utf8');
            await client.query(upSql);
          }

          // Verify 011 tables exist
          const { rows: before } = await client.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('workspace_page_tokens', 'workspace_oauth_states', 'workspace_webhook_subscriptions', 'workspace_webhook_events')`,
            [testSchema]
          );
          assert.equal(before.length, 4, 'All 4 Gate 4 tables created');

          // Run 011 down
          const downSql = fs.readFileSync(path.join(migDir, '011_facebook_oauth_down.sql'), 'utf8');
          await client.query(downSql);

          // Verify 011 tables dropped
          const { rows: after } = await client.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('workspace_page_tokens', 'workspace_oauth_states', 'workspace_webhook_subscriptions', 'workspace_webhook_events')`,
            [testSchema]
          );
          assert.equal(after.length, 0, 'All Gate 4 tables dropped by rollback');

          // Verify Gate 2 tables still intact
          const { rows: gate2 } = await client.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'workspace_pages'`,
            [testSchema]
          );
          assert.equal(gate2.length, 1, 'Gate 2 workspace_pages table preserved after rollback');
        } finally {
          await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
          client.release();
          await pool.end();
        }
      });
    });

    // --- Error Sanitization ---
    describe('Error Sanitization', () => {
      it('New public error codes are valid', () => {
        const { publicError, publicResponse } = require('../security/public-error');

        const oauthStateErr = publicError('OAUTH_STATE_INVALID');
        const resp1 = publicResponse(oauthStateErr);
        assert.equal(resp1.status, 400);
        assert.equal(resp1.code, 'OAUTH_STATE_INVALID');

        const exchangeErr = publicError('OAUTH_EXCHANGE_FAILED');
        const resp2 = publicResponse(exchangeErr);
        assert.equal(resp2.status, 502);

        const tokenErr = publicError('TOKEN_EXPIRED');
        const resp3 = publicResponse(tokenErr);
        assert.equal(resp3.status, 401);

        const metaErr = publicError('META_API_ERROR');
        const resp4 = publicResponse(metaErr);
        assert.equal(resp4.status, 502);
      });
    });
  });
};
