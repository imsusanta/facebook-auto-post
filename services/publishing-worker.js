'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const tenantPublishingRepository = require('../repositories/tenant-publishing-repository');
const tenantPostRepository = require('../repositories/tenant-post-repository');
const tenantPageRepository = require('../repositories/tenant-page-repository');
const facebookOAuthRepository = require('../repositories/facebook-oauth-repository');
const publishingClient = require('./publishing-client');
const tokenVault = require('./token-vault');
const { broadcastSSE } = require('../middleware/sse');

class PublishingWorker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.workerId = options.workerId || `worker_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.concurrency = options.concurrency || 2;
    this.maxRetries = options.maxRetries || 5;
    this.baseIntervalSeconds = options.baseIntervalSeconds || 10;
    this.isRunning = false;
    this._pollTimer = null;
    this._isTickRunning = false;
    this._activeJobsCount = 0;

    // Circuit Breaker State: Map<workspacePageId, { failureCount, trippedUntil }>
    this._circuitBreakers = new Map();
    this.circuitThreshold = options.circuitThreshold || 5;
    this.circuitCooldownMs = options.circuitCooldownMs || 300000; // 5 minutes
  }

  isCircuitTripped(workspacePageId) {
    if (!workspacePageId) return false;
    const cb = this._circuitBreakers.get(workspacePageId);
    if (!cb) return false;
    if (cb.trippedUntil && cb.trippedUntil > Date.now()) {
      return true;
    }
    if (cb.trippedUntil && cb.trippedUntil <= Date.now()) {
      this._circuitBreakers.delete(workspacePageId);
    }
    return false;
  }

  recordCircuitFailure(workspacePageId) {
    if (!workspacePageId) return;
    const now = Date.now();
    const cb = this._circuitBreakers.get(workspacePageId) || { failureCount: 0, trippedUntil: null };
    cb.failureCount++;
    if (cb.failureCount >= this.circuitThreshold) {
      cb.trippedUntil = now + this.circuitCooldownMs;
      this.emit('circuit_tripped', { workspacePageId, trippedUntil: cb.trippedUntil });
    }
    this._circuitBreakers.set(workspacePageId, cb);
  }

  recordCircuitSuccess(workspacePageId) {
    if (!workspacePageId) return;
    this._circuitBreakers.delete(workspacePageId);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._scheduleNextTick(0);
    this.emit('started', { workerId: this.workerId });
  }

  stop() {
    this.isRunning = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    this.emit('stopped', { workerId: this.workerId });
  }

  _scheduleNextTick(delayMs) {
    if (!this.isRunning) return;
    this._pollTimer = setTimeout(async () => {
      await this.tick();
      if (this.isRunning) {
        this._scheduleNextTick(this.pollIntervalMs);
      }
    }, delayMs);
  }

  /**
   * Executes a single worker tick: recovers stale jobs, claims queued jobs, processes them.
   */
  async tick() {
    if (this._isTickRunning) return 0;
    this._isTickRunning = true;
    let processedCount = 0;

    try {
      // 1. Stale Job Recovery (Every tick checks if previous worker died)
      await tenantPublishingRepository.recoverStaleJobs({ staleThresholdMinutes: 5 }).catch(() => {});

      // 2. Claim available jobs
      const jobs = await tenantPublishingRepository.claimNextJobs({
        workerId: this.workerId,
        limit: this.concurrency
      });

      if (!jobs || jobs.length === 0) {
        return 0;
      }

      // 3. Process claimed jobs concurrently up to concurrency limit
      const promises = jobs.map(job => this.processJob(job));
      const results = await Promise.allSettled(promises);
      processedCount = results.filter(r => r.status === 'fulfilled').length;
    } catch (tickErr) {
      this.emit('error', tickErr);
    } finally {
      this._isTickRunning = false;
    }

    return processedCount;
  }

  /**
   * Processes a single publish job through the complete idempotency and safety boundary.
   */
  async processJob(job) {
    this._activeJobsCount++;
    const startTime = Date.now();
    const attemptNumber = (job.retry_count || 0) + 1;

    try {
      // 1. Check Circuit Breaker
      if (job.workspace_page_id && this.isCircuitTripped(job.workspace_page_id)) {
        await tenantPublishingRepository.failJob({
          workspaceId: job.workspace_id,
          jobId: job.id,
          postId: job.post_id,
          idempotencyKey: job.idempotency_key,
          errorCode: 'CIRCUIT_BREAKER_ACTIVE',
          errorMessage: 'Publishing paused for this page due to repeated provider errors. Circuit breaker active.',
          isRetryable: true,
          baseIntervalSeconds: 60,
          maxRetries: job.max_retries
        });
        return { success: false, reason: 'circuit_breaker_tripped' };
      }

      // 2. Retrieve Post
      const post = await tenantPostRepository.getPostById({
        workspaceId: job.workspace_id,
        postId: job.post_id
      });

      if (!post) {
        await tenantPublishingRepository.failJob({
          workspaceId: job.workspace_id,
          jobId: job.id,
          postId: job.post_id,
          idempotencyKey: job.idempotency_key,
          errorCode: 'POST_DELETED',
          errorMessage: 'Post record was deleted before publishing could occur.',
          isRetryable: false
        });
        return { success: false, reason: 'post_not_found' };
      }

      const requestHash = crypto.createHash('sha256').update(post.caption || '').digest('hex');

      // 3. Ambiguous Provider Response Reconciliation Check
      // If this is a retry and previous attempt might have reached Facebook, check feed first
      if (job.retry_count > 0 && job.workspace_page_id) {
        try {
          const pageRow = await tenantPageRepository.getPageById({
            workspaceId: job.workspace_id,
            pageId: post.page_id
          });
          if (pageRow) {
            const tokenRow = await facebookOAuthRepository.getActiveToken({
              workspacePageId: pageRow.id
            });
            if (tokenRow) {
              const accessToken = tokenVault.decrypt(tokenRow.token_encrypted, pageRow.id);
              const reconcileResult = await publishingClient.reconcileAmbiguousPublish({
                pageId: pageRow.page_id,
                accessToken,
                expectedCaption: post.caption,
                sinceTimestamp: job.created_at
              });

              if (reconcileResult && reconcileResult.reconciled && reconcileResult.fbPostId) {
                // Post already landed on Facebook! Reconcile as published without duplicate.
                await tenantPublishingRepository.recordAttempt({
                  workspaceId: job.workspace_id,
                  jobId: job.id,
                  postId: post.id,
                  attemptNumber,
                  status: 'success',
                  requestHash,
                  fbPostId: reconcileResult.fbPostId,
                  durationMs: Date.now() - startTime
                });

                const completed = await tenantPublishingRepository.completeJob({
                  workspaceId: job.workspace_id,
                  jobId: job.id,
                  postId: post.id,
                  fbPostId: reconcileResult.fbPostId,
                  idempotencyKey: job.idempotency_key
                });

                this.recordCircuitSuccess(job.workspace_page_id);
                broadcastSSE('post_success', { postId: post.id, fbPostId: reconcileResult.fbPostId, reconciled: true });
                broadcastSSE('publish_job_updated', { jobId: job.id, status: 'published' });
                return { success: true, reconciled: true, fbPostId: reconcileResult.fbPostId };
              }
            }
          }
        } catch (reconcileErr) {
          // Reconcile probe failed; proceed with normal publish attempt
        }
      }

      // 4. Dispatch Publish Call
      const publishResult = await publishingClient.publish({
        workspaceId: job.workspace_id,
        workspacePageId: job.workspace_page_id,
        post
      });

      // 5. Success Handling
      const durationMs = Date.now() - startTime;
      await tenantPublishingRepository.recordAttempt({
        workspaceId: job.workspace_id,
        jobId: job.id,
        postId: post.id,
        attemptNumber,
        status: 'success',
        requestHash,
        fbPostId: publishResult.fbPostId,
        durationMs
      });

      const completed = await tenantPublishingRepository.completeJob({
        workspaceId: job.workspace_id,
        jobId: job.id,
        postId: post.id,
        fbPostId: publishResult.fbPostId,
        idempotencyKey: job.idempotency_key
      });

      this.recordCircuitSuccess(job.workspace_page_id);
      broadcastSSE('post_success', { postId: post.id, fbPostId: publishResult.fbPostId });
      broadcastSSE('publish_job_updated', { jobId: job.id, status: 'published' });

      return { success: true, fbPostId: publishResult.fbPostId };
    } catch (publishErr) {
      // 6. Failure Handling & Telemetry Redaction
      const durationMs = Date.now() - startTime;
      const { isRetryable, code } = publishingClient.classifyError(publishErr);
      const isAmbiguous = publishingClient.isAmbiguousError(publishErr);

      const requestHash = crypto.createHash('sha256').update(String(job.id) + attemptNumber).digest('hex');

      await tenantPublishingRepository.recordAttempt({
        workspaceId: job.workspace_id,
        jobId: job.id,
        postId: job.post_id,
        attemptNumber,
        status: isAmbiguous ? 'ambiguous' : 'failed',
        requestHash,
        errorCode: code,
        errorMessage: publishErr.message,
        durationMs
      });

      if (job.workspace_page_id && (!isRetryable || code.startsWith('FB_AUTH_'))) {
        this.recordCircuitFailure(job.workspace_page_id);
      }

      await tenantPublishingRepository.failJob({
        workspaceId: job.workspace_id,
        jobId: job.id,
        postId: job.post_id,
        idempotencyKey: job.idempotency_key,
        errorCode: code,
        errorMessage: publishErr.message,
        isRetryable,
        baseIntervalSeconds: this.baseIntervalSeconds,
        maxRetries: this.maxRetries
      });

      broadcastSSE('post_failed', { postId: job.post_id, error: publishErr.message });
      broadcastSSE('publish_job_updated', { jobId: job.id, status: isRetryable ? 'queued' : 'dead_letter' });

      return { success: false, error: publishErr.message, isRetryable };
    } finally {
      this._activeJobsCount--;
    }
  }
}

module.exports = new PublishingWorker();
module.exports.PublishingWorker = PublishingWorker;
