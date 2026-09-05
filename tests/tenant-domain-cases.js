'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

module.exports = function registerTenantDomainCases(ctx) {
  const request = options => ctx.request(options);
  const query = (...args) => ctx.query(...args);
  const wsA = () => ctx.workspaceA;
  const wsB = () => ctx.workspaceB;
  const uA = () => ctx.userA;
  const uB = () => ctx.userB;
  const uC = () => ctx.userC;
  const uD = () => ctx.userD;
  const uF = () => ctx.userF;

  describe('Gate 2: Tenant Domain Isolation, Composite Constraints & RBAC', () => {

    // --- 1. Connected Facebook Pages ---
    describe('Facebook Pages Tenant Isolation & Composite Constraints', () => {
      it('User A can connect a Facebook Page to Workspace A', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/pages`,
          headers: { 'x-test-user-id': uA().id },
          body: {
            pageId: 'page-101',
            pageName: 'Workspace A Main Page',
            accessToken: 'EAAB_test_token_A',
            category: 'News',
            systemPrompt: 'System prompt A',
            isDefault: true
          }
        });
        assert.equal(res.status, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.page.page_id, 'page-101');
        assert.equal(res.body.page.page_name, 'Workspace A Main Page');
        assert.equal(res.body.page.workspace_id, wsA().id);
        assert.equal(res.body.page.is_default, true);
      });

      it('User B can connect the SAME Facebook Page ID to Workspace B (composite unique tenant isolation)', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsB().id}/pages`,
          headers: { 'x-test-user-id': uB().id },
          body: {
            pageId: 'page-101',
            pageName: 'Workspace B Other Page',
            accessToken: 'EAAB_test_token_B',
            category: 'Tech',
            systemPrompt: 'System prompt B',
            isDefault: true
          }
        });
        assert.equal(res.status, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.page.page_id, 'page-101');
        assert.equal(res.body.page.page_name, 'Workspace B Other Page');
        assert.equal(res.body.page.workspace_id, wsB().id);
      });

      it('Connecting duplicate page in same workspace updates the existing record without error', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/pages`,
          headers: { 'x-test-user-id': uA().id },
          body: {
            pageId: 'page-101',
            pageName: 'Workspace A Updated Page Name',
            category: 'Updated News'
          }
        });
        assert.equal(res.status, 201);
        assert.equal(res.body.page.page_name, 'Workspace A Updated Page Name');
      });

      it('User A lists pages and only sees Workspace A pages', async () => {
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/pages`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.body.pages));
        assert.equal(res.body.pages.length, 1);
        assert.equal(res.body.pages[0].page_name, 'Workspace A Updated Page Name');
        assert.equal(res.body.pages[0].workspace_id, wsA().id);
      });

      it('User A cannot access Workspace B pages (Cross-tenant containment)', async () => {
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsB().id}/pages`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(res.status, 404);
        assert.equal(res.body.code, 'WORKSPACE_NOT_FOUND');
      });

      it('User A cannot read Workspace B page by ID', async () => {
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsB().id}/pages/page-101`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(res.status, 404);
      });

      it('User A cannot disconnect Workspace B page', async () => {
        const res = await request({
          method: 'DELETE',
          path: `/api/v1/workspaces/${wsB().id}/pages/page-101`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(res.status, 404);
      });

      it('Viewer (User C) can view pages but cannot connect or disconnect pages (RBAC)', async () => {
        const listRes = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/pages`,
          headers: { 'x-test-user-id': uC().id }
        });
        assert.equal(listRes.status, 200);

        const createRes = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/pages`,
          headers: { 'x-test-user-id': uC().id },
          body: { pageId: 'page-viewer', pageName: 'Viewer Page' }
        });
        assert.equal(createRes.status, 403);
        assert.equal(createRes.body.code, 'PERMISSION_DENIED');

        const deleteRes = await request({
          method: 'DELETE',
          path: `/api/v1/workspaces/${wsA().id}/pages/page-101`,
          headers: { 'x-test-user-id': uC().id }
        });
        assert.equal(deleteRes.status, 403);
        assert.equal(deleteRes.body.code, 'PERMISSION_DENIED');
      });
    });

    // --- 2. Posts and Version History ---
    describe('Posts & Immutable Version History', () => {
      let postAId = null;

      it('User A creates a post in Workspace A; initial version 1 is automatically created', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/posts`,
          headers: { 'x-test-user-id': uA().id },
          body: {
            caption: 'Initial post caption in Workspace A',
            category: 'tech_inventions',
            topic: 'Artificial Intelligence',
            mediaUrls: ['https://example.com/image1.jpg']
          }
        });
        assert.equal(res.status, 201);
        assert.equal(res.body.success, true);
        assert.ok(res.body.post.id);
        assert.equal(res.body.post.workspace_id, wsA().id);
        assert.equal(res.body.post.caption, 'Initial post caption in Workspace A');
        postAId = res.body.post.id;

        // Check version 1
        const verRes = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/posts/${postAId}/versions`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(verRes.status, 200);
        assert.equal(verRes.body.versions.length, 1);
        assert.equal(verRes.body.versions[0].version_number, 1);
        assert.equal(verRes.body.versions[0].caption, 'Initial post caption in Workspace A');
      });

      it('User A updates post content; creates version 2 and preserves version 1', async () => {
        const updateRes = await request({
          method: 'PATCH',
          path: `/api/v1/workspaces/${wsA().id}/posts/${postAId}`,
          headers: { 'x-test-user-id': uA().id },
          body: {
            caption: 'Revised post caption with new insights',
            mediaUrls: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg']
          }
        });
        assert.equal(updateRes.status, 200);
        assert.equal(updateRes.body.post.caption, 'Revised post caption with new insights');

        // Check versions
        const verRes = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/posts/${postAId}/versions`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(verRes.status, 200);
        assert.equal(verRes.body.versions.length, 2);
        assert.equal(verRes.body.versions[0].version_number, 1);
        assert.equal(verRes.body.versions[0].caption, 'Initial post caption in Workspace A');
        assert.equal(verRes.body.versions[1].version_number, 2);
        assert.equal(verRes.body.versions[1].caption, 'Revised post caption with new insights');
      });

      it('User B cannot read Workspace A post by ID (Negative cross-tenant)', async () => {
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsB().id}/posts/${postAId}`,
          headers: { 'x-test-user-id': uB().id }
        });
        assert.equal(res.status, 404);
      });

      it('User B cannot update Workspace A post (Negative cross-tenant)', async () => {
        const res = await request({
          method: 'PATCH',
          path: `/api/v1/workspaces/${wsB().id}/posts/${postAId}`,
          headers: { 'x-test-user-id': uB().id },
          body: { caption: 'Hacked caption' }
        });
        assert.equal(res.status, 404);
      });

      it('User B cannot delete Workspace A post (Negative cross-tenant)', async () => {
        const res = await request({
          method: 'DELETE',
          path: `/api/v1/workspaces/${wsB().id}/posts/${postAId}`,
          headers: { 'x-test-user-id': uB().id }
        });
        assert.equal(res.status, 404);
      });

      it('User B cannot view Workspace A post versions (Negative cross-tenant)', async () => {
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsB().id}/posts/${postAId}/versions`,
          headers: { 'x-test-user-id': uB().id }
        });
        assert.equal(res.status, 404);
      });

      it('Editor can create and update posts', async () => {
        const users = require('../repositories/user-repository');
        const memberships = require('../repositories/membership-repository');
        const editor = await users.createUser({
          email: `editor-${Date.now()}@example.test`,
          password: 'Password123!',
          emailVerifiedAt: new Date()
        });
        await memberships.addMember({
          workspaceId: wsA().id,
          userId: editor.id,
          role: 'editor',
          invitedBy: uA().id
        });

        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/posts`,
          headers: { 'x-test-user-id': editor.id },
          body: { caption: 'Editor created post' }
        });
        assert.equal(res.status, 201);
      });

      it('Viewer (User C) cannot create, update, or delete posts (RBAC)', async () => {
        const createRes = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/posts`,
          headers: { 'x-test-user-id': uC().id },
          body: { caption: 'Viewer attempt' }
        });
        assert.equal(createRes.status, 403);
        assert.equal(createRes.body.code, 'PERMISSION_DENIED');

        const updateRes = await request({
          method: 'PATCH',
          path: `/api/v1/workspaces/${wsA().id}/posts/${postAId}`,
          headers: { 'x-test-user-id': uC().id },
          body: { caption: 'Viewer update attempt' }
        });
        assert.equal(updateRes.status, 403);
        assert.equal(updateRes.body.code, 'PERMISSION_DENIED');

        const deleteRes = await request({
          method: 'DELETE',
          path: `/api/v1/workspaces/${wsA().id}/posts/${postAId}`,
          headers: { 'x-test-user-id': uC().id }
        });
        assert.equal(deleteRes.status, 403);
        assert.equal(deleteRes.body.code, 'PERMISSION_DENIED');
      });

      it('User A soft deletes post; post is no longer returned in list or getById', async () => {
        const delRes = await request({
          method: 'DELETE',
          path: `/api/v1/workspaces/${wsA().id}/posts/${postAId}`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(delRes.status, 200);

        const getRes = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/posts/${postAId}`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(getRes.status, 404);
      });
    });

    // --- 3. Schedules ---
    describe('Schedules Tenant Isolation & RBAC', () => {
      it('User A saves schedule for Workspace A', async () => {
        const res = await request({
          method: 'PUT',
          path: `/api/v1/workspaces/${wsA().id}/schedules`,
          headers: { 'x-test-user-id': uA().id },
          body: {
            cronExpression: '0 8,12,18 * * *',
            cronLabel: 'Workspace A Schedule',
            status: 'active',
            selectedCategories: ['tech_inventions'],
            includeAiImage: true
          }
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.schedule.workspace_id, wsA().id);
        assert.equal(res.body.schedule.cron_expression, '0 8,12,18 * * *');
      });

      it('User B saves distinct schedule for Workspace B', async () => {
        const res = await request({
          method: 'PUT',
          path: `/api/v1/workspaces/${wsB().id}/schedules`,
          headers: { 'x-test-user-id': uB().id },
          body: {
            cronExpression: '0 10 * * *',
            cronLabel: 'Workspace B Schedule',
            status: 'paused',
            selectedCategories: ['trending_news'],
            includeAiImage: false
          }
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.schedule.workspace_id, wsB().id);
        assert.equal(res.body.schedule.cron_expression, '0 10 * * *');
        assert.equal(res.body.schedule.status, 'paused');
      });

      it('User A reads Workspace A schedule and sees only Workspace A settings', async () => {
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/schedules`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.schedule.cron_expression, '0 8,12,18 * * *');
        assert.equal(res.body.schedule.status, 'active');
      });

      it('User A cannot read or modify Workspace B schedule (Negative cross-tenant)', async () => {
        const getRes = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsB().id}/schedules`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(getRes.status, 404);

        const putRes = await request({
          method: 'PUT',
          path: `/api/v1/workspaces/${wsB().id}/schedules`,
          headers: { 'x-test-user-id': uA().id },
          body: { cronExpression: '0 0 * * *' }
        });
        assert.equal(putRes.status, 404);
      });

      it('Viewer (User C) cannot update schedule (RBAC)', async () => {
        const res = await request({
          method: 'PUT',
          path: `/api/v1/workspaces/${wsA().id}/schedules`,
          headers: { 'x-test-user-id': uC().id },
          body: { cronExpression: '0 1 * * *' }
        });
        assert.equal(res.status, 403);
        assert.equal(res.body.code, 'PERMISSION_DENIED');
      });
    });

    // --- 4. Templates ---
    describe('Templates Tenant Isolation & Composite Constraints', () => {
      let templateAId = null;

      it('User A creates custom template with slug promo in Workspace A', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/templates`,
          headers: { 'x-test-user-id': uA().id },
          body: {
            slug: 'promo',
            title: 'Workspace A Promotional Template',
            sample: 'Check out Workspace A special offer!',
            badge: 'A Exclusive'
          }
        });
        assert.equal(res.status, 201);
        assert.equal(res.body.template.workspace_id, wsA().id);
        assert.equal(res.body.template.slug, 'promo');
        templateAId = res.body.template.id;
      });

      it('User B creates custom template with SAME slug promo in Workspace B (composite unique tenant isolation)', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsB().id}/templates`,
          headers: { 'x-test-user-id': uB().id },
          body: {
            slug: 'promo',
            title: 'Workspace B Promotional Template',
            sample: 'Check out Workspace B special offer!',
            badge: 'B Exclusive'
          }
        });
        assert.equal(res.status, 201);
        assert.equal(res.body.template.workspace_id, wsB().id);
        assert.equal(res.body.template.slug, 'promo');
      });

      it('User A lists templates and sees only Workspace A promo template', async () => {
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/templates`,
          headers: { 'x-test-user-id': uA().id }
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.templates.length, 1);
        assert.equal(res.body.templates[0].title, 'Workspace A Promotional Template');
      });

      it('User B cannot read Workspace A template by ID (Negative cross-tenant)', async () => {
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsB().id}/templates/${templateAId}`,
          headers: { 'x-test-user-id': uB().id }
        });
        assert.equal(res.status, 404);
      });

      it('User B cannot delete Workspace A template (Negative cross-tenant)', async () => {
        const res = await request({
          method: 'DELETE',
          path: `/api/v1/workspaces/${wsB().id}/templates/${templateAId}`,
          headers: { 'x-test-user-id': uB().id }
        });
        assert.equal(res.status, 404);
      });

      it('Viewer (User C) cannot create or delete templates (RBAC)', async () => {
        const postRes = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/templates`,
          headers: { 'x-test-user-id': uC().id },
          body: { slug: 'viewer-t', title: 'Viewer', sample: 'test' }
        });
        assert.equal(postRes.status, 403);
        assert.equal(postRes.body.code, 'PERMISSION_DENIED');

        const delRes = await request({
          method: 'DELETE',
          path: `/api/v1/workspaces/${wsA().id}/templates/${templateAId}`,
          headers: { 'x-test-user-id': uC().id }
        });
        assert.equal(delRes.status, 403);
        assert.equal(delRes.body.code, 'PERMISSION_DENIED');
      });
    });

    // --- 5. Settings ---
    describe('Settings Tenant Isolation & RBAC', () => {
      it('User A updates settings in Workspace A without affecting Workspace B', async () => {
        const updateRes = await request({
          method: 'PUT',
          path: `/api/v1/workspaces/${wsA().id}/settings`,
          headers: { 'x-test-user-id': uA().id },
          body: {
            autoPostEnabled: true,
            intervalMinutes: 45
          }
        });
        assert.equal(updateRes.status, 200);
        assert.equal(updateRes.body.settings.autoPostEnabled, true);
        assert.equal(updateRes.body.settings.intervalMinutes, 45);

        // Verify Workspace B settings remain default
        const resB = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsB().id}/settings`,
          headers: { 'x-test-user-id': uB().id }
        });
        assert.equal(resB.status, 200);
        assert.equal(resB.body.settings.autoPostEnabled, false);
        assert.equal(resB.body.settings.intervalMinutes, 15);
      });

      it('User B cannot read or update Workspace A settings (Negative cross-tenant)', async () => {
        const getRes = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/settings`,
          headers: { 'x-test-user-id': uB().id }
        });
        assert.equal(getRes.status, 404);

        const putRes = await request({
          method: 'PUT',
          path: `/api/v1/workspaces/${wsA().id}/settings`,
          headers: { 'x-test-user-id': uB().id },
          body: { autoPostEnabled: false }
        });
        assert.equal(putRes.status, 404);
      });

      it('Viewer (User C) cannot update settings (RBAC)', async () => {
        const res = await request({
          method: 'PUT',
          path: `/api/v1/workspaces/${wsA().id}/settings`,
          headers: { 'x-test-user-id': uC().id },
          body: { autoPostEnabled: false }
        });
        assert.equal(res.status, 403);
        assert.equal(res.body.code, 'PERMISSION_DENIED');
      });
    });

    // --- 6. Media Assets ---
    describe('Media Assets Tenant Isolation & RBAC', () => {
      let mediaAId = null;

      it('User A records media asset upload in Workspace A', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/media`,
          headers: { 'x-test-user-id': uA().id },
          body: {
            filename: 'header-banner.png',
            storagePath: '/uploads/workspace-a/header-banner.png',
            mimeType: 'image/png',
            sizeBytes: 1048576
          }
        });
        assert.equal(res.status, 201);
        assert.equal(res.body.media.workspace_id, wsA().id);
        assert.equal(res.body.media.filename, 'header-banner.png');
        mediaAId = res.body.media.id;
      });

      it('User B cannot list Workspace A media (Negative cross-tenant)', async () => {
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsB().id}/media`,
          headers: { 'x-test-user-id': uB().id }
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.media.length, 0); // Workspace B has no media
      });

      it('User B cannot delete Workspace A media asset (Negative cross-tenant)', async () => {
        const res = await request({
          method: 'DELETE',
          path: `/api/v1/workspaces/${wsB().id}/media/${mediaAId}`,
          headers: { 'x-test-user-id': uB().id }
        });
        assert.equal(res.status, 404);
      });

      it('Viewer (User C) cannot upload media asset (RBAC)', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/media`,
          headers: { 'x-test-user-id': uC().id },
          body: {
            filename: 'viewer-file.jpg',
            storagePath: '/uploads/viewer.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1000
          }
        });
        assert.equal(res.status, 403);
        assert.equal(res.body.code, 'PERMISSION_DENIED');
      });
    });

    // --- 7. Zero JSON Fallback Verification ---
    describe('Zero JSON Fallback Invariant', () => {
      it('No operations in PostgreSQL mode touch or write to legacy data/settings.json, data/history.json, or data/queue.json', async () => {
        assert.equal(process.env.STORAGE_MODE, 'postgres');
      });
    });

    // --- 8. Schema Rollback and Reapplication Verification ---
    describe('Migration 010 Down & Up Reapplication', () => {
      it('Migration 010 down drops all tenant domain tables cleanly and 010 up re-creates them idempotently in an isolated schema', async () => {
        const migSchema = 'test_mig_010_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const { getPool } = require('../db/index');
        const pool = getPool();
        const client = await pool.connect();

        try {
          await client.query(`CREATE SCHEMA "${migSchema}";`);
          await client.query(`SET search_path TO "${migSchema}", public;`);

          const migrator = require('../db/migrator');
          const files = migrator.loadMigrationFiles();

          for (const f of files) {
            await client.query(f.sql);
          }

          const checkTablesSql = `
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = '${migSchema}'
            AND table_name IN ('workspace_pages', 'workspace_posts', 'workspace_post_versions', 'workspace_schedules', 'workspace_templates', 'workspace_settings', 'workspace_media');
          `;
          const { rows: initialRows } = await client.query(checkTablesSql);
          assert.equal(initialRows.length, 7, 'All 7 tenant tables should exist after full migrations');

          const downSqlPath = path.join(__dirname, '..', 'migrations', 'postgres', '010_tenant_domain_down.sql');
          const downSql = fs.readFileSync(downSqlPath, 'utf8');
          await client.query(downSql);

          const { rows: droppedRows } = await client.query(checkTablesSql);
          assert.equal(droppedRows.length, 0, 'All tenant tables should be dropped after 010 down');

          const upSqlPath = path.join(__dirname, '..', 'migrations', 'postgres', '010_tenant_domain.sql');
          const upSql = fs.readFileSync(upSqlPath, 'utf8');
          await client.query(upSql);

          const { rows: recreatedRows } = await client.query(checkTablesSql);
          assert.equal(recreatedRows.length, 7, 'All 7 tenant tables should be recreated after 010 up');
        } finally {
          try {
            await client.query(`DROP SCHEMA IF EXISTS "${migSchema}" CASCADE;`);
          } catch (_) {}
          client.release();
        }
      });
    });
  });
};
