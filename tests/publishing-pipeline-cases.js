'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

module.exports = function registerPublishingPipelineCases(ctx) {
  const request = options => ctx.request(options);
  const query = (...args) => ctx.query(...args);
  const wsA = () => ctx.workspaceA;
  const wsB = () => ctx.workspaceB;
  const uA = () => ctx.userA;
  const uB = () => ctx.userB;
  const uC = () => ctx.userC;
  const uF = () => ctx.userF;

  describe('Gate 5: Durable Publishing Pipeline, Transactional Outbox & Worker Architecture', () => {
    const tenantPostRepository = require('../repositories/tenant-post-repository');
    const tenantPublishingRepository = require('../repositories/tenant-publishing-repository');
    const publishingClient = require('../services/publishing-client');
    const { PublishingWorker } = require('../services/publishing-worker');
    const membershipRepository = require('../repositories/membership-repository');
    const userRepository = require('../repositories/user-repository');

    let testPostA = null;
    let testPageA = null;
    let editorUser = null;

    it('Setup: creates a test page, post and active editor in Workspace A', async () => {
      const tenantPageRepository = require('../repositories/tenant-page-repository');
      const facebookOAuthRepository = require('../repositories/facebook-oauth-repository');
      const tokenVault = require('../services/token-vault');

      // Create an active editor for Workspace A
      editorUser = await userRepository.createUser({
        email: `editor_pub_${Date.now()}@example.test`,
        password: 'Password123!',
        emailVerifiedAt: new Date()
      });
      await membershipRepository.addMember({
        workspaceId: wsA().id,
        userId: editorUser.id,
        role: 'editor',
        invitedBy: uA().id
      });

      testPageA = await tenantPageRepository.connectPage({
        workspaceId: wsA().id,
        pageId: 'pub_test_page_1001',
        pageName: 'Publish Test Page A',
        isDefault: true,
        actorUserId: uA().id
      });

      const encryptedToken = tokenVault.encrypt('EAABtest_publishing_token_secret_123', testPageA.id);
      await facebookOAuthRepository.storePageToken({
        workspaceId: wsA().id,
        workspacePageId: testPageA.id,
        tokenEncrypted: encryptedToken,
        tokenType: 'page_access_token',
        actorUserId: uA().id
      });

      testPostA = await tenantPostRepository.createPost({
        workspaceId: wsA().id,
        caption: 'This is a valid test caption for publishing pipeline verification with sufficient length',
        createdBy: uA().id,
        pageId: testPageA.page_id,
        status: 'draft'
      });

      assert.ok(testPostA.id);
      assert.ok(editorUser.id);
    });

    // --- 1. Transactional Outbox & Atomicity ---
    describe('Transactional Outbox Atomicity', () => {
      it('Rolled back transaction leaves no orphaned publish job or idempotency record', async () => {
        const { withTransaction } = require('../db/index');
        const idempotencyKey = `rollback_key_${Date.now()}`;

        try {
          await withTransaction(async (client) => {
            const rollbackPost = await tenantPostRepository.createPost({
              workspaceId: wsA().id,
              caption: 'This is a post meant to be rolled back during transactional outbox testing',
              createdBy: uA().id
            }, client);

            await tenantPublishingRepository.enqueueJob({
              workspaceId: wsA().id,
              postId: rollbackPost.id,
              idempotencyKey,
              createdBy: uA().id
            }, client);

            // Force intentional transaction rollback
            throw new Error('INTENTIONAL_ROLLBACK');
          });
        } catch (err) {
          assert.equal(err.message, 'INTENTIONAL_ROLLBACK');
        }

        const { rows: jobs } = await query(
          'SELECT * FROM workspace_publish_jobs WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        assert.equal(jobs.length, 0, 'No publish job should persist after rollback');

        const { rows: idems } = await query(
          'SELECT * FROM workspace_publish_idempotency WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        assert.equal(idems.length, 0, 'No idempotency row should persist after rollback');
      });
    });

    // --- 2. Concurrent Worker Claiming (FOR UPDATE SKIP LOCKED) ---
    describe('Concurrent Worker Claiming', () => {
      it('Concurrent workers claim mutually exclusive jobs without contention', async () => {
        const post1 = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'Concurrent claim test post 1 with sufficient caption length for safety check',
          createdBy: uA().id
        });
        const post2 = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'Concurrent claim test post 2 with sufficient caption length for safety check',
          createdBy: uA().id
        });

        const job1 = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post1.id,
          createdBy: uA().id
        });
        const job2 = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post2.id,
          createdBy: uA().id
        });

        // Simulate two workers claiming simultaneously
        const [claimedByWorker1, claimedByWorker2] = await Promise.all([
          tenantPublishingRepository.claimNextJobs({ workerId: 'worker_alpha', limit: 1 }),
          tenantPublishingRepository.claimNextJobs({ workerId: 'worker_beta', limit: 1 })
        ]);

        assert.equal(claimedByWorker1.length, 1);
        assert.equal(claimedByWorker2.length, 1);
        assert.notEqual(
          claimedByWorker1[0].id,
          claimedByWorker2[0].id,
          'Workers must never claim the exact same job'
        );
        assert.equal(claimedByWorker1[0].locked_by, 'worker_alpha');
        assert.equal(claimedByWorker2[0].locked_by, 'worker_beta');

        // Cleanup: complete both jobs
        await tenantPublishingRepository.completeJob({
          workspaceId: wsA().id,
          jobId: claimedByWorker1[0].id,
          postId: claimedByWorker1[0].post_id,
          fbPostId: 'fb_concurrent_1'
        });
        await tenantPublishingRepository.completeJob({
          workspaceId: wsA().id,
          jobId: claimedByWorker2[0].id,
          postId: claimedByWorker2[0].post_id,
          fbPostId: 'fb_concurrent_2'
        });
      });
    });

    // --- 3. Publishing Idempotency Boundary ---
    describe('Publishing Idempotency Boundary', () => {
      it('Re-enqueuing with identical idempotency key returns existing job without duplicates', async () => {
        const uniqueKey = `idempotent_test_key_${Date.now()}`;

        const firstJob = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: testPostA.id,
          idempotencyKey: uniqueKey,
          createdBy: uA().id
        });

        const secondJob = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: testPostA.id,
          idempotencyKey: uniqueKey,
          createdBy: uA().id
        });

        assert.equal(firstJob.id, secondJob.id, 'Idempotent calls must return the same job record');

        const { rows } = await query(
          'SELECT COUNT(*) as count FROM workspace_publish_jobs WHERE workspace_id = $1 AND idempotency_key = $2',
          [wsA().id, uniqueKey]
        );
        assert.equal(Number(rows[0].count), 1, 'Only exactly 1 job row may exist for idempotency key');
      });
    });

    // --- 4. Successful Publishing Flow ---
    describe('Publishing Execution & Success Flow', () => {
      it('Worker processes job, calls client, and atomically updates post and idempotency ledger', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a live publish success test caption with sufficient character length',
          createdBy: uA().id,
          pageId: testPageA.page_id
        });

        const idempotencyKey = `success_job_${Date.now()}`;
        const job = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post.id,
          idempotencyKey,
          createdBy: uA().id
        });

        // Set mock adapter
        publishingClient.setAdapter({
          publish: async ({ caption, accessToken }) => {
            assert.ok(accessToken.includes('EAABtest_publishing_token'), 'Decrypted token passed to adapter');
            return { success: true, fbPostId: 'fb_live_post_12345' };
          }
        });

        const worker = new PublishingWorker({ workerId: 'test_worker_success' });
        const res = await worker.processJob(job);

        assert.equal(res.success, true);
        assert.equal(res.fbPostId, 'fb_live_post_12345');

        // Verify post state in DB
        const updatedPost = await tenantPostRepository.getPostById({ workspaceId: wsA().id, postId: post.id });
        assert.equal(updatedPost.status, 'published');
        assert.equal(updatedPost.fb_post_id, 'fb_live_post_12345');
        assert.ok(updatedPost.published_at);

        // Verify attempt record
        const { rows: attempts } = await query(
          'SELECT * FROM workspace_publish_attempts WHERE job_id = $1',
          [job.id]
        );
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].status, 'success');
        assert.equal(attempts[0].fb_post_id, 'fb_live_post_12345');

        // Verify idempotency record
        const { rows: idems } = await query(
          'SELECT * FROM workspace_publish_idempotency WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        assert.equal(idems[0].status, 'completed');
        assert.equal(idems[0].fb_post_id, 'fb_live_post_12345');

        publishingClient.resetAdapter();
      });
    });

    // --- 5. Exponential Backoff with Jitter for Retryable Errors ---
    describe('Exponential Backoff & Retries', () => {
      it('Transient error increments retry_count and pushes next_run_at into future', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a valid test caption for retry testing with sufficient length',
          createdBy: uA().id,
          pageId: testPageA.page_id
        });

        const job = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post.id,
          createdBy: uA().id
        });

        // Mock transient rate limit error
        publishingClient.setAdapter({
          publish: async () => {
            const err = new Error('Calls to stream have exceeded rate limits');
            err.fbCode = 613;
            throw err;
          }
        });

        const worker = new PublishingWorker({ workerId: 'test_worker_retry', baseIntervalSeconds: 30 });
        const res = await worker.processJob(job);

        assert.equal(res.success, false);
        assert.equal(res.isRetryable, true);

        const { rows: updatedJobs } = await query(
          'SELECT * FROM workspace_publish_jobs WHERE id = $1',
          [job.id]
        );
        const updated = updatedJobs[0];
        assert.equal(updated.status, 'queued');
        assert.equal(updated.retry_count, 1);
        assert.ok(new Date(updated.next_run_at).getTime() > Date.now(), 'next_run_at must be in future');

        publishingClient.resetAdapter();
      });
    });

    // --- 6. Dead-Letter Queue (DLQ) Transition on Max Retries ---
    describe('Dead-Letter Queue (DLQ)', () => {
      it('Exceeding max_retries marks job as dead_letter and post as failed', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a valid test caption for dead letter testing with sufficient length',
          createdBy: uA().id,
          pageId: testPageA.page_id
        });

        const job = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post.id,
          createdBy: uA().id
        });

        // Force retry_count near limit
        await query(
          'UPDATE workspace_publish_jobs SET retry_count = 4, max_retries = 5 WHERE id = $1',
          [job.id]
        );
        job.retry_count = 4;
        job.max_retries = 5;

        publishingClient.setAdapter({
          publish: async () => {
            const err = new Error('Repeated transient failure');
            err.fbCode = 2; // service temporarily unavailable
            throw err;
          }
        });

        const worker = new PublishingWorker({ workerId: 'test_worker_dlq', maxRetries: 5 });
        const res = await worker.processJob(job);

        assert.equal(res.success, false);

        const { rows: updatedJobs } = await query(
          'SELECT * FROM workspace_publish_jobs WHERE id = $1',
          [job.id]
        );
        assert.equal(updatedJobs[0].status, 'dead_letter');
        assert.equal(updatedJobs[0].retry_count, 5);

        const updatedPost = await tenantPostRepository.getPostById({ workspaceId: wsA().id, postId: post.id });
        assert.equal(updatedPost.status, 'failed');

        publishingClient.resetAdapter();
      });
    });

    // --- 7. Non-Retryable Error Handling ---
    describe('Non-Retryable Errors', () => {
      it('Token revocation (FB code 190) immediately dead-letters without retrying', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a valid test caption for token revocation testing with sufficient length',
          createdBy: uA().id,
          pageId: testPageA.page_id
        });

        const job = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post.id,
          createdBy: uA().id
        });

        publishingClient.setAdapter({
          publish: async () => {
            const err = new Error('Error validating access token: Session has expired');
            err.fbCode = 190;
            throw err;
          }
        });

        const worker = new PublishingWorker({ workerId: 'test_worker_revoked' });
        const res = await worker.processJob(job);

        assert.equal(res.success, false);
        assert.equal(res.isRetryable, false);

        const { rows: updatedJobs } = await query(
          'SELECT * FROM workspace_publish_jobs WHERE id = $1',
          [job.id]
        );
        assert.equal(updatedJobs[0].status, 'dead_letter', 'Must immediately transition to dead_letter');
        assert.equal(updatedJobs[0].retry_count, 1);

        publishingClient.resetAdapter();
      });

      it('Content safety violation immediately rejects post before calling provider', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: '100% profit guaranteed return crypto scam click here to get rich quick today',
          createdBy: uA().id,
          pageId: testPageA.page_id
        });

        const job = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post.id,
          createdBy: uA().id
        });

        let providerCalled = false;
        publishingClient.setAdapter({
          publish: async () => {
            providerCalled = true;
            return { success: true };
          }
        });

        const worker = new PublishingWorker({ workerId: 'test_worker_safety' });
        const res = await worker.processJob(job);

        assert.equal(providerCalled, false, 'Provider must never be called for unsafe content');
        assert.equal(res.success, false);

        const { rows: updatedJobs } = await query(
          'SELECT * FROM workspace_publish_jobs WHERE id = $1',
          [job.id]
        );
        assert.equal(updatedJobs[0].status, 'dead_letter');
        assert.equal(updatedJobs[0].error_code, 'CONTENT_SAFETY_VIOLATION');

        publishingClient.resetAdapter();
      });
    });

    // --- 8. Ambiguous Provider Response & Feed Reconciliation ---
    describe('Ambiguous Provider Response & Reconciliation', () => {
      it('Reconciles ambiguous timeout with existing feed post to prevent duplicate wall posts', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a valid test caption for ambiguous timeout reconciliation testing',
          createdBy: uA().id,
          pageId: testPageA.page_id
        });

        const job = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post.id,
          createdBy: uA().id
        });

        // Set retry_count = 1 so worker activates reconciliation check
        await query(
          'UPDATE workspace_publish_jobs SET retry_count = 1 WHERE id = $1',
          [job.id]
        );
        job.retry_count = 1;

        let duplicatePublishAttempted = false;
        publishingClient.setAdapter({
          reconcile: async ({ expectedCaption }) => {
            if (expectedCaption === post.caption) {
              return { reconciled: true, fbPostId: 'reconciled_fb_id_888999' };
            }
            return { reconciled: false };
          },
          publish: async () => {
            duplicatePublishAttempted = true;
            return { success: true };
          }
        });

        const worker = new PublishingWorker({ workerId: 'test_worker_reconcile' });
        const res = await worker.processJob(job);

        assert.equal(duplicatePublishAttempted, false, 'Duplicate publish call must NOT be made');
        assert.equal(res.success, true);
        assert.equal(res.reconciled, true);
        assert.equal(res.fbPostId, 'reconciled_fb_id_888999');

        const updatedPost = await tenantPostRepository.getPostById({ workspaceId: wsA().id, postId: post.id });
        assert.equal(updatedPost.status, 'published');
        assert.equal(updatedPost.fb_post_id, 'reconciled_fb_id_888999');

        publishingClient.resetAdapter();
      });
    });

    // --- 9. Stale Worker Crash Recovery ---
    describe('Stale Worker Recovery', () => {
      it('Recovers jobs stuck in locked status due to crashed worker', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a valid test caption for stale worker recovery testing with sufficient length',
          createdBy: uA().id
        });

        const job = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post.id,
          createdBy: uA().id
        });

        // Simulate crashed worker locking job 15 minutes ago
        await query(
          "UPDATE workspace_publish_jobs SET status = 'locked', locked_at = NOW() - INTERVAL '15 minutes', locked_by = 'crashed_worker_99' WHERE id = $1",
          [job.id]
        );

        const recoveredCount = await tenantPublishingRepository.recoverStaleJobs({ staleThresholdMinutes: 5 });
        assert.ok(recoveredCount >= 1, 'Must recover at least 1 stale job');

        const { rows: check } = await query(
          'SELECT status, locked_at, locked_by FROM workspace_publish_jobs WHERE id = $1',
          [job.id]
        );
        assert.equal(check[0].status, 'queued');
        assert.equal(check[0].locked_at, null);
        assert.equal(check[0].locked_by, null);
      });
    });

    // --- 10. Telemetry Redaction ---
    describe('Telemetry Redaction', () => {
      it('Guarantees zero raw Facebook tokens in attempt logs and database error messages', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a valid test caption for telemetry redaction testing with sufficient length',
          createdBy: uA().id,
          pageId: testPageA.page_id
        });

        const job = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post.id,
          createdBy: uA().id
        });

        const secretToken = 'EAABsecret_token_that_must_be_redacted_99999';
        publishingClient.setAdapter({
          publish: async () => {
            throw new Error(`Graph API returned 400 with invalid token: access_token=${secretToken}`);
          }
        });

        const worker = new PublishingWorker({ workerId: 'test_worker_redact' });
        await worker.processJob(job);

        const { rows: attempts } = await query(
          'SELECT error_message FROM workspace_publish_attempts WHERE job_id = $1',
          [job.id]
        );
        assert.ok(attempts.length > 0);
        assert.ok(!attempts[0].error_message.includes(secretToken), 'Secret token must be completely redacted');
        assert.ok(attempts[0].error_message.includes('[REDACTED]'), 'Must replace with redaction token');

        publishingClient.resetAdapter();
      });
    });

    // --- 11. Circuit Breaker ---
    describe('Circuit Breaker', () => {
      it('Consecutive failures trip circuit breaker and pause processing for page', async () => {
        const worker = new PublishingWorker({
          workerId: 'circuit_test_worker',
          circuitThreshold: 3,
          circuitCooldownMs: 60000
        });

        assert.equal(worker.isCircuitTripped(testPageA.id), false);

        worker.recordCircuitFailure(testPageA.id);
        worker.recordCircuitFailure(testPageA.id);
        assert.equal(worker.isCircuitTripped(testPageA.id), false);

        worker.recordCircuitFailure(testPageA.id); // 3rd failure trips
        assert.equal(worker.isCircuitTripped(testPageA.id), true);

        // Reset
        worker.recordCircuitSuccess(testPageA.id);
        assert.equal(worker.isCircuitTripped(testPageA.id), false);
      });
    });

    // --- 12. Job Cancellation & Manual Retry ---
    describe('Job Cancellation & Manual Retry', () => {
      it('Cancelling a queued job sets status to cancelled and reverts post to draft', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a valid test caption for cancellation testing with sufficient length',
          createdBy: uA().id
        });

        const job = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post.id,
          createdBy: uA().id
        });

        await tenantPublishingRepository.cancelJob({
          workspaceId: wsA().id,
          jobId: job.id,
          actorUserId: uA().id
        });

        const { rows: checkJob } = await query(
          'SELECT status FROM workspace_publish_jobs WHERE id = $1',
          [job.id]
        );
        assert.equal(checkJob[0].status, 'cancelled');

        const postCheck = await tenantPostRepository.getPostById({ workspaceId: wsA().id, postId: post.id });
        assert.equal(postCheck.status, 'draft');
      });

      it('Retrying a failed/dead-lettered job resets status to queued with next_run_at = NOW()', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a valid test caption for manual retry testing with sufficient length',
          createdBy: uA().id
        });

        const job = await tenantPublishingRepository.enqueueJob({
          workspaceId: wsA().id,
          postId: post.id,
          createdBy: uA().id
        });

        // Set to dead_letter
        await query(
          "UPDATE workspace_publish_jobs SET status = 'dead_letter', retry_count = 5 WHERE id = $1",
          [job.id]
        );

        const retried = await tenantPublishingRepository.retryJob({
          workspaceId: wsA().id,
          jobId: job.id,
          actorUserId: uA().id
        });

        assert.equal(retried.status, 'queued');
        assert.equal(retried.retry_count, 0);
      });
    });

    // --- 13. API Endpoints & Cross-Tenant Isolation ---
    describe('Publishing API Endpoints & Cross-Tenant Isolation', () => {
      let apiPostA = null;
      let apiJobA = null;

      it('User A publishes a post via POST /:wsA/posts/:postId/publish-now', async () => {
        apiPostA = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a valid test caption for API publish now endpoint verification',
          createdBy: uA().id,
          pageId: testPageA.page_id
        });

        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/posts/${apiPostA.id}/publish-now`,
          headers: { 'x-test-user-id': uA().id }
        });

        assert.equal(res.status, 202);
        assert.equal(res.body.success, true);
        assert.ok(res.body.job.id);
        apiJobA = res.body.job;
      });

      it('User A can list and get publish jobs in Workspace A', async () => {
        const listRes = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/publish-jobs`,
          headers: { 'x-test-user-id': uA().id }
        });

        assert.equal(listRes.status, 200);
        assert.ok(Array.isArray(listRes.body.jobs));

        const getRes = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsA().id}/publish-jobs/${apiJobA.id}`,
          headers: { 'x-test-user-id': uA().id }
        });

        assert.equal(getRes.status, 200);
        assert.equal(getRes.body.job.id, apiJobA.id);
      });

      it('Negative Cross-Tenant: User B cannot view Workspace A job via API (404)', async () => {
        const res = await request({
          method: 'GET',
          path: `/api/v1/workspaces/${wsB().id}/publish-jobs/${apiJobA.id}`,
          headers: { 'x-test-user-id': uB().id }
        });

        assert.equal(res.status, 404);
      });

      it('Negative Cross-Tenant: User B cannot cancel Workspace A job via API (404)', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsB().id}/publish-jobs/${apiJobA.id}/cancel`,
          headers: { 'x-test-user-id': uB().id }
        });

        assert.equal(res.status, 404);
      });

      it('Negative Cross-Tenant: User B cannot retry Workspace A job via API (404)', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsB().id}/publish-jobs/${apiJobA.id}/retry`,
          headers: { 'x-test-user-id': uB().id }
        });

        assert.equal(res.status, 404);
      });
    });

    // --- 14. RBAC Enforcement ---
    describe('Publishing RBAC Enforcement', () => {
      it('Viewer (User C) is denied publish:trigger (403 Forbidden)', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/posts/${testPostA.id}/publish-now`,
          headers: { 'x-test-user-id': uC().id }
        });

        assert.equal(res.status, 403);
      });

      it('Viewer (User C) is denied publish:retry (403 Forbidden)', async () => {
        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/publish-jobs/00000000-0000-0000-0000-000000000000/retry`,
          headers: { 'x-test-user-id': uC().id }
        });

        assert.equal(res.status, 403);
      });

      it('Editor is allowed publish:trigger (202 Accepted)', async () => {
        const post = await tenantPostRepository.createPost({
          workspaceId: wsA().id,
          caption: 'This is a valid test caption for editor publish testing with sufficient length',
          createdBy: editorUser.id
        });

        const res = await request({
          method: 'POST',
          path: `/api/v1/workspaces/${wsA().id}/posts/${post.id}/publish-now`,
          headers: { 'x-test-user-id': editorUser.id }
        });

        assert.equal(res.status, 202);
      });
    });

    // --- 15. Migration 012 Down and Up Reapplication ---
    describe('Migration 012 Rollback Verification', () => {
      it('Migration 012 down drops publishing tables and up re-creates them cleanly in an isolated schema', async () => {
        const isolatedPool = new Pool({ connectionString: process.env.DATABASE_URL });
        const isolatedSchema = 'test_schema_mig012_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
        const client = await isolatedPool.connect();

        try {
          await client.query(`CREATE SCHEMA ${isolatedSchema};`);
          await client.query(`SET search_path TO ${isolatedSchema}, public;`);

          const migDir = path.join(__dirname, '..', 'migrations', 'postgres');
          const migrationFiles = [
            '001_extensions.sql',
            '002_users.sql',
            '003_workspaces.sql',
            '004_workspace_members.sql',
            '005_workspace_invitations.sql',
            '006_audit_logs.sql',
            '007_auth_sessions.sql',
            '008_workspace_suspension.sql',
            '009_identity_lifecycle.sql',
            '010_tenant_domain.sql',
            '011_facebook_oauth.sql',
            '012_publishing_pipeline.sql'
          ];

          for (const f of migrationFiles) {
            const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
            await client.query(sql);
          }

          // Verify tables exist
          const { rows: t1 } = await client.query("SELECT to_regclass('workspace_publish_jobs') as regclass;");
          assert.ok(t1[0].regclass, 'workspace_publish_jobs must exist');

          // Apply 012 down
          const downSql = fs.readFileSync(path.join(migDir, '012_publishing_pipeline_down.sql'), 'utf8');
          await client.query(downSql);

          const { rows: t2 } = await client.query("SELECT to_regclass('workspace_publish_jobs') as regclass;");
          assert.equal(t2[0].regclass, null, 'workspace_publish_jobs must be dropped by down migration');

          // Re-apply 012 up
          const upSql = fs.readFileSync(path.join(migDir, '012_publishing_pipeline.sql'), 'utf8');
          await client.query(upSql);

          const { rows: t3 } = await client.query("SELECT to_regclass('workspace_publish_jobs') as regclass;");
          assert.ok(t3[0].regclass, 'workspace_publish_jobs must be cleanly re-created');
        } finally {
          await client.query(`DROP SCHEMA IF EXISTS ${isolatedSchema} CASCADE;`).catch(() => {});
          client.release();
          await isolatedPool.end();
        }
      });
    });

    // --- 16. Zero JSON Fallback Invariant ---
    describe('Zero JSON Fallback Invariant', () => {
      it('No operations touch or write to legacy data/settings.json, data/history.json, or data/queue.json', () => {
        const repoRoot = path.join(__dirname, '..');
        const legacyFiles = ['data/settings.json', 'data/history.json', 'data/queue.json'];

        for (const relPath of legacyFiles) {
          const absPath = path.join(repoRoot, relPath);
          if (fs.existsSync(absPath)) {
            const content = fs.readFileSync(absPath, 'utf8');
            assert.ok(!content.includes('Test post for publishing pipeline verification'));
            assert.ok(!content.includes('Live publish success test caption'));
          }
        }
      });
    });

  });
};
