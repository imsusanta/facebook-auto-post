'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const { publicError } = require('../security/public-error');
const auditLogRepository = require('./audit-log-repository');

function sanitizeSecretStrings(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/EAAB[0-9a-zA-Z]+/g, '[REDACTED_FB_TOKEN]')
    .replace(/EAA[0-9a-zA-Z]{15,}/g, '[REDACTED_FB_TOKEN]')
    .replace(/(access_token=)[^& \t\n\r]+/gi, '$1[REDACTED]')
    .replace(/(client_secret=)[^& \t\n\r]+/gi, '$1[REDACTED]');
}

class TenantPublishingRepository {

  /**
   * Enqueues a publishing job for a post with transactional outbox guarantees.
   */
  async enqueueJob({
    workspaceId,
    postId,
    workspacePageId = null,
    scheduledAt = null,
    createdBy = null,
    idempotencyKey = null,
    requestId = null
  }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    if (!isValidUuid(postId)) throw publicError('VALIDATION_FAILED', 'Invalid postId UUID');
    if (workspacePageId && !isValidUuid(workspacePageId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspacePageId UUID');
    }

    const resolvedKey = idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim()
      ? idempotencyKey.trim()
      : `pub_${workspaceId}_${postId}_${Date.now()}`;

    const executeInTx = async (client) => {
      // 1. Lock workspace
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Workspace not found or inactive.');
      }

      // 2. Lock post
      const { rows: postRows } = await client.query(
        'SELECT id, workspace_id, page_id, status, caption, media_urls FROM workspace_posts WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL FOR UPDATE',
        [postId, workspaceId]
      );
      if (postRows.length === 0) {
        throw publicError('RESOURCE_NOT_FOUND', 'Post not found in workspace.');
      }
      const post = postRows[0];

      // 3. Resolve page if needed
      let targetWorkspacePageId = workspacePageId;
      if (!targetWorkspacePageId) {
        if (post.page_id) {
          const { rows: pRows } = await client.query(
            'SELECT id FROM workspace_pages WHERE workspace_id = $1 AND page_id = $2 AND deleted_at IS NULL',
            [workspaceId, post.page_id]
          );
          if (pRows.length > 0) targetWorkspacePageId = pRows[0].id;
        }
        if (!targetWorkspacePageId) {
          const { rows: defaultRows } = await client.query(
            'SELECT id FROM workspace_pages WHERE workspace_id = $1 AND is_default = true AND deleted_at IS NULL LIMIT 1',
            [workspaceId]
          );
          if (defaultRows.length > 0) targetWorkspacePageId = defaultRows[0].id;
        }
      }

      // 4. Check idempotency ledger for duplicate submission
      const { rows: idemRows } = await client.query(
        'SELECT * FROM workspace_publish_idempotency WHERE workspace_id = $1 AND idempotency_key = $2',
        [workspaceId, resolvedKey]
      );
      if (idemRows.length > 0) {
        const existingIdem = idemRows[0];
        const { rows: existingJobRows } = await client.query(
          'SELECT * FROM workspace_publish_jobs WHERE workspace_id = $1 AND idempotency_key = $2',
          [workspaceId, resolvedKey]
        );
        return existingJobRows[0] || null;
      }

      // 5. Register in idempotency ledger
      const idemId = generateUuid();
      await client.query(
        `INSERT INTO workspace_publish_idempotency (id, workspace_id, idempotency_key, post_id, status)
         VALUES ($1, $2, $3, $4, 'in_flight')`,
        [idemId, workspaceId, resolvedKey, postId]
      );

      // 6. Insert publish job into outbox
      const jobId = generateUuid();
      const nextRun = scheduledAt ? new Date(scheduledAt) : new Date();
      const insertJobSql = `
        INSERT INTO workspace_publish_jobs (
          id, workspace_id, post_id, workspace_page_id, status,
          idempotency_key, next_run_at, created_by
        )
        VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7)
        RETURNING *;
      `;
      const { rows: jobRows } = await client.query(insertJobSql, [
        jobId,
        workspaceId,
        postId,
        targetWorkspacePageId,
        resolvedKey,
        nextRun,
        createdBy
      ]);
      const job = jobRows[0];

      // 7. Update post status to scheduled or publishing
      const newPostStatus = scheduledAt && new Date(scheduledAt) > new Date() ? 'scheduled' : 'publishing';
      await client.query(
        'UPDATE workspace_posts SET status = $1, scheduled_at = $2, updated_at = NOW() WHERE id = $3 AND workspace_id = $4',
        [newPostStatus, scheduledAt, postId, workspaceId]
      );

      // 8. Record audit log
      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId: createdBy,
        action: 'publish_job:enqueued',
        resourceType: 'publish_job',
        resourceId: job.id,
        requestId,
        metadata: {
          jobId: job.id,
          postId,
          scheduledAt,
          idempotencyKey: resolvedKey
        }
      }, client);

      return job;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Atomically claims queued jobs for a worker using PostgreSQL FOR UPDATE SKIP LOCKED.
   */
  async claimNextJobs({ workerId, limit = 5 }, clientOverride = null) {
    if (!workerId || typeof workerId !== 'string') {
      throw publicError('VALIDATION_FAILED', 'workerId is required');
    }
    const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 50);

    const executeInTx = async (client) => {
      // 1. Select with row-level lock and skip locked rows
      const selectSql = `
        SELECT id, workspace_id, post_id, workspace_page_id, idempotency_key,
               retry_count, max_retries, error_code
        FROM workspace_publish_jobs
        WHERE status = 'queued'
          AND next_run_at <= NOW()
        ORDER BY next_run_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED;
      `;
      const { rows: candidateRows } = await client.query(selectSql, [safeLimit]);
      if (candidateRows.length === 0) return [];

      const jobIds = candidateRows.map(r => r.id);

      // 2. Lock them for this worker
      const updateSql = `
        UPDATE workspace_publish_jobs
        SET status = 'locked',
            locked_at = NOW(),
            locked_by = $1,
            updated_at = NOW()
        WHERE id = ANY($2::uuid[])
        RETURNING *;
      `;
      const { rows: claimedRows } = await client.query(updateSql, [workerId, jobIds]);
      return claimedRows;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Records a sanitized publishing attempt with telemetry redaction.
   */
  async recordAttempt({
    workspaceId,
    jobId,
    postId,
    attemptNumber,
    status,
    requestHash,
    fbPostId = null,
    errorCode = null,
    errorMessage = null,
    durationMs = null
  }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    if (!isValidUuid(jobId)) throw publicError('VALIDATION_FAILED', 'Invalid jobId UUID');
    if (!isValidUuid(postId)) throw publicError('VALIDATION_FAILED', 'Invalid postId UUID');

    const sanitizedMsg = sanitizeSecretStrings(errorMessage);
    const sanitizedHash = requestHash || crypto.createHash('sha256').update(String(jobId) + String(attemptNumber)).digest('hex');
    const attemptId = generateUuid();

    const sql = `
      INSERT INTO workspace_publish_attempts (
        id, workspace_id, job_id, post_id, attempt_number,
        status, request_hash, fb_post_id, error_code, error_message, duration_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `;
    const exec = clientOverride || { query: (text, params) => query(text, params) };
    const { rows } = await exec.query(sql, [
      attemptId,
      workspaceId,
      jobId,
      postId,
      attemptNumber,
      status,
      sanitizedHash,
      fbPostId,
      errorCode,
      sanitizedMsg,
      durationMs
    ]);
    return rows[0];
  }

  /**
   * Completes a publish job atomically.
   */
  async completeJob({
    workspaceId,
    jobId,
    postId,
    fbPostId,
    idempotencyKey,
    actorUserId = null,
    requestId = null
  }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    if (!isValidUuid(jobId)) throw publicError('VALIDATION_FAILED', 'Invalid jobId UUID');
    if (!isValidUuid(postId)) throw publicError('VALIDATION_FAILED', 'Invalid postId UUID');
    if (!fbPostId || typeof fbPostId !== 'string') throw publicError('VALIDATION_FAILED', 'fbPostId is required');

    const executeInTx = async (client) => {
      // 1. Update job
      const { rows: jobRows } = await client.query(
        `UPDATE workspace_publish_jobs
         SET status = 'published',
             locked_at = NULL,
             locked_by = NULL,
             error_code = NULL,
             error_message = NULL,
             updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2
         RETURNING *;`,
        [jobId, workspaceId]
      );

      // 2. Update post
      await client.query(
        `UPDATE workspace_posts
         SET status = 'published',
             fb_post_id = $1,
             published_at = NOW(),
             error_message = NULL,
             updated_at = NOW()
         WHERE id = $2 AND workspace_id = $3`,
        [fbPostId, postId, workspaceId]
      );

      // 3. Update idempotency ledger
      if (idempotencyKey) {
        await client.query(
          `UPDATE workspace_publish_idempotency
           SET status = 'completed',
               fb_post_id = $1,
               updated_at = NOW()
           WHERE workspace_id = $2 AND idempotency_key = $3`,
          [fbPostId, workspaceId, idempotencyKey]
        );
      }

      // 4. Record audit event
      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'post:published',
        resourceType: 'post',
        resourceId: postId,
        requestId,
        metadata: {
          jobId,
          postId,
          fbPostId
        }
      }, client);

      return jobRows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Fails a publish job, scheduling an exponential backoff retry or transitioning to dead_letter.
   */
  async failJob({
    workspaceId,
    jobId,
    postId,
    idempotencyKey = null,
    errorCode = 'PUBLISH_ERROR',
    errorMessage = 'Publishing failed',
    isRetryable = false,
    baseIntervalSeconds = 10,
    maxRetries = 5,
    actorUserId = null,
    requestId = null
  }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    if (!isValidUuid(jobId)) throw publicError('VALIDATION_FAILED', 'Invalid jobId UUID');
    if (!isValidUuid(postId)) throw publicError('VALIDATION_FAILED', 'Invalid postId UUID');

    const sanitizedMsg = sanitizeSecretStrings(errorMessage);

    const executeInTx = async (client) => {
      const { rows: curRows } = await client.query(
        'SELECT retry_count, max_retries FROM workspace_publish_jobs WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
        [jobId, workspaceId]
      );
      if (curRows.length === 0) throw publicError('RESOURCE_NOT_FOUND', 'Job not found');

      const cur = curRows[0];
      const nextRetryCount = cur.retry_count + 1;
      const limitRetries = maxRetries || cur.max_retries || 5;

      if (isRetryable && nextRetryCount < limitRetries) {
        // Calculate exponential backoff with jitter
        const backoff = Math.min(
          Math.floor(baseIntervalSeconds * Math.pow(2, nextRetryCount - 1) + (Math.random() * 2)),
          3600
        );

        const { rows: updated } = await client.query(
          `UPDATE workspace_publish_jobs
           SET status = 'queued',
               retry_count = $1,
               next_run_at = NOW() + ($2 || ' seconds')::interval,
               locked_at = NULL,
               locked_by = NULL,
               error_code = $3,
               error_message = $4,
               updated_at = NOW()
           WHERE id = $5 AND workspace_id = $6
           RETURNING *;`,
          [nextRetryCount, String(backoff), errorCode, sanitizedMsg, jobId, workspaceId]
        );

        await client.query(
          'UPDATE workspace_posts SET error_message = $1, updated_at = NOW() WHERE id = $2 AND workspace_id = $3',
          [sanitizedMsg, postId, workspaceId]
        );

        return updated[0];
      } else {
        // Dead letter queue transition
        const { rows: updated } = await client.query(
          `UPDATE workspace_publish_jobs
           SET status = 'dead_letter',
               retry_count = $1,
               locked_at = NULL,
               locked_by = NULL,
               error_code = $2,
               error_message = $3,
               updated_at = NOW()
           WHERE id = $4 AND workspace_id = $5
           RETURNING *;`,
          [nextRetryCount, errorCode, sanitizedMsg, jobId, workspaceId]
        );

        await client.query(
          `UPDATE workspace_posts
           SET status = 'failed',
               error_message = $1,
               updated_at = NOW()
           WHERE id = $2 AND workspace_id = $3`,
          [sanitizedMsg, postId, workspaceId]
        );

        if (idempotencyKey) {
          await client.query(
            `UPDATE workspace_publish_idempotency
             SET status = 'failed',
                 updated_at = NOW()
             WHERE workspace_id = $1 AND idempotency_key = $2`,
            [workspaceId, idempotencyKey]
          );
        }

        await auditLogRepository.recordEvent({
          workspaceId,
          actorUserId,
          action: 'post:publish_failed',
          resourceType: 'post',
          resourceId: postId,
          requestId,
          metadata: {
            jobId,
            postId,
            errorCode,
            isRetryable,
            retryCount: nextRetryCount
          }
        }, client);

        return updated[0];
      }
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Cancels a queued publishing job.
   */
  async cancelJob({ workspaceId, jobId, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    if (!isValidUuid(jobId)) throw publicError('VALIDATION_FAILED', 'Invalid jobId UUID');

    const executeInTx = async (client) => {
      const { rows: jobRows } = await client.query(
        'SELECT id, status, post_id, idempotency_key FROM workspace_publish_jobs WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
        [jobId, workspaceId]
      );
      if (jobRows.length === 0) throw publicError('RESOURCE_NOT_FOUND', 'Job not found in workspace.');

      const job = jobRows[0];
      if (job.status !== 'queued') {
        throw publicError('VALIDATION_FAILED', `Cannot cancel job with status "${job.status}". Only queued jobs can be cancelled.`);
      }

      await client.query(
        `UPDATE workspace_publish_jobs
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2`,
        [jobId, workspaceId]
      );

      await client.query(
        `UPDATE workspace_posts
         SET status = 'draft',
             updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2`,
        [job.post_id, workspaceId]
      );

      if (job.idempotency_key) {
        await client.query(
          `DELETE FROM workspace_publish_idempotency WHERE workspace_id = $1 AND idempotency_key = $2`,
          [workspaceId, job.idempotency_key]
        );
      }

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'publish_job:cancelled',
        resourceType: 'publish_job',
        resourceId: jobId,
        requestId,
        metadata: { jobId, postId: job.post_id }
      }, client);

      return true;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Manually retries a failed or dead-lettered job.
   */
  async retryJob({ workspaceId, jobId, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    if (!isValidUuid(jobId)) throw publicError('VALIDATION_FAILED', 'Invalid jobId UUID');

    const executeInTx = async (client) => {
      const { rows: jobRows } = await client.query(
        'SELECT id, status, post_id, idempotency_key FROM workspace_publish_jobs WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
        [jobId, workspaceId]
      );
      if (jobRows.length === 0) throw publicError('RESOURCE_NOT_FOUND', 'Job not found in workspace.');

      const job = jobRows[0];
      if (!['failed', 'dead_letter'].includes(job.status)) {
        throw publicError('VALIDATION_FAILED', `Cannot retry job with status "${job.status}". Only failed or dead-lettered jobs can be retried.`);
      }

      const { rows: updated } = await client.query(
        `UPDATE workspace_publish_jobs
         SET status = 'queued',
             retry_count = 0,
             next_run_at = NOW(),
             locked_at = NULL,
             locked_by = NULL,
             error_code = NULL,
             error_message = NULL,
             updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2
         RETURNING *;`,
        [jobId, workspaceId]
      );

      await client.query(
        `UPDATE workspace_posts
         SET status = 'publishing',
             error_message = NULL,
             updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2`,
        [job.post_id, workspaceId]
      );

      if (job.idempotency_key) {
        await client.query(
          `UPDATE workspace_publish_idempotency
           SET status = 'in_flight',
               updated_at = NOW()
           WHERE workspace_id = $1 AND idempotency_key = $2`,
          [workspaceId, job.idempotency_key]
        );
      }

      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'publish_job:retried',
        resourceType: 'publish_job',
        resourceId: jobId,
        requestId,
        metadata: { jobId, postId: job.post_id }
      }, client);

      return updated[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Recovers stale jobs locked by crashed or timed-out workers.
   */
  async recoverStaleJobs({ staleThresholdMinutes = 5 }, clientOverride = null) {
    const executeInTx = async (client) => {
      const sql = `
        SELECT id, workspace_id, post_id, retry_count
        FROM workspace_publish_jobs
        WHERE status IN ('locked', 'publishing')
          AND locked_at < NOW() - ($1 || ' minutes')::interval
        FOR UPDATE SKIP LOCKED;
      `;
      const { rows: staleRows } = await client.query(sql, [staleThresholdMinutes]);
      if (staleRows.length === 0) return 0;

      const jobIds = staleRows.map(r => r.id);
      await client.query(
        `UPDATE workspace_publish_jobs
         SET status = 'queued',
             locked_at = NULL,
             locked_by = NULL,
             updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [jobIds]
      );

      return staleRows.length;
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  /**
   * Lists jobs for a workspace with pagination.
   */
  async listJobs({ workspaceId, status = null, limit = 50, offset = 0 }, client = null) {
    if (!isValidUuid(workspaceId)) return [];

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const conditions = ['workspace_id = $1'];
    const params = [workspaceId];

    if (status && typeof status === 'string') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    params.push(safeLimit);
    const limitParam = `$${params.length}`;
    params.push(safeOffset);
    const offsetParam = `$${params.length}`;

    const sql = `
      SELECT * FROM workspace_publish_jobs
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;

    const exec = client || { query: (text, p) => query(text, p) };
    const { rows } = await exec.query(sql, params);
    return rows;
  }

  /**
   * Retrieves single job and its attempt history.
   */
  async getJobById({ workspaceId, jobId }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(jobId)) return null;

    const exec = client || { query: (text, p) => query(text, p) };
    const { rows: jobRows } = await exec.query(
      'SELECT * FROM workspace_publish_jobs WHERE workspace_id = $1 AND id = $2',
      [workspaceId, jobId]
    );
    if (jobRows.length === 0) return null;

    const job = jobRows[0];
    const { rows: attemptRows } = await exec.query(
      'SELECT * FROM workspace_publish_attempts WHERE workspace_id = $1 AND job_id = $2 ORDER BY attempt_number ASC',
      [workspaceId, jobId]
    );

    return {
      ...job,
      attempts: attemptRows
    };
  }
}

module.exports = new TenantPublishingRepository();
