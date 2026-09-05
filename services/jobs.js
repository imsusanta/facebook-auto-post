const { randomUUID, createHash } = require('node:crypto');
const db = require('./db');
const context = require('../security/context');
const secrets = require('../security/secrets');
const { backoff } = require('./publishing-errors');
const LEASE_SECONDS = 120;
function ws() {
  return context.current().workspaceId;
}
function hydrate(row) {
  if (!row) return null;
  return {
    ...secrets.open(row.data),
    id: row.id,
    facebookPageId: row.facebook_page_id,
    status: row.status,
    kind: row.kind,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at?.toISOString() || null,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at?.toISOString() || null,
    dispatchStartedAt: row.dispatch_started_at?.toISOString() || null,
    timeZone: row.time_zone,
    errorCode: row.last_error_code,
    error: row.last_error_message
  };
}
async function get(id) {
  return hydrate(
    (
      await db.query(
        'SELECT * FROM scheduled_posts WHERE workspace_id=$1 AND id=$2',
        [ws(), id]
      )
    ).rows[0]
  );
}
async function create(
  data,
  { operationKey = randomUUID(), kind = 'publish' } = {}
) {
  const owner = ws();
  return db.transaction(async () => {
    let imageIdentity = data.imageUrl || null;
    if (imageIdentity?.startsWith('/uploads/')) {
      const row = (
        await db.query(
          'SELECT content_sha256 FROM media_assets WHERE workspace_id=$1 AND filename=$2',
          [owner, imageIdentity.slice(9)]
        )
      ).rows[0];
      if (!row)
        throw Object.assign(new Error('Owned image not found'), {
          statusCode: 400,
          expose: true
        });
      imageIdentity = row.content_sha256 || imageIdentity;
    }
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          page: data.facebookPageId,
          message: data.message || '',
          image: imageIdentity,
          scheduledAt: data.scheduledAt || null,
          timeZone: data.timeZone || 'UTC',
          kind,
          source: data.source || 'scheduler',
          isDemo: !!data.isDemo,
          topic: data.topic || '',
          categoryId: data.categoryId || '',
          includeImage: data.includeImage !== false
        })
      )
      .digest('hex');
    const previous = (
      await db.query(
        'SELECT * FROM publication_intents WHERE workspace_id=$1 AND operation_key=$2',
        [owner, operationKey]
      )
    ).rows[0];
    if (previous) {
      if (previous.payload_hash !== payloadHash)
        throw Object.assign(
          new Error('This idempotency key was used for different content'),
          { statusCode: 409, expose: true }
        );
      const existing = previous.job_id ? await get(previous.job_id) : null;
      if (existing) return { ...existing, replayed: true };
      return {
        id: null,
        replayed: true,
        status: previous.receipt?.status || 'removed',
        receipt: previous.receipt
      };
    }
    const id = 'queue_' + randomUUID(),
      value = {
        ...data,
        id,
        kind,
        status: 'pending',
        createdAt: new Date().toISOString(),
        timeZone: data.timeZone || 'UTC'
      };
    await db.query(
      `INSERT INTO scheduled_posts(workspace_id,id,facebook_page_id,status,scheduled_at,created_at,kind,time_zone,data) VALUES($1,$2,$3,'pending',$4,$5,$6,$7,$8)`,
      [
        owner,
        id,
        value.facebookPageId,
        value.scheduledAt,
        value.createdAt,
        kind,
        value.timeZone,
        secrets.seal(value)
      ]
    );
    await db.query(
      'INSERT INTO publication_intents(workspace_id,operation_key,payload_hash,job_id) VALUES($1,$2,$3,$4)',
      [owner, operationKey, payloadHash, id]
    );
    return get(id);
  }, owner);
}
async function claim(id, { forceDue = false } = {}) {
  return db.transaction(async () => {
    const lease = randomUUID();
    const result = await db.query(
      `UPDATE scheduled_posts SET status='processing',attempt_count=attempt_count+1,lease_owner=$3,lease_expires_at=now()+$4*interval '1 second',processing_at=now(),dispatch_started_at=NULL,
   data=jsonb_set(jsonb_set(data,'{status}','"processing"'),'{processingAt}',to_jsonb(now())) || CASE WHEN $5 THEN '{"publishNowRequested":true}'::jsonb ELSE '{}'::jsonb END
   WHERE workspace_id=$1 AND id=$2 AND status IN ('pending','retry_wait') AND attempt_count<max_attempts
   AND (next_attempt_at IS NULL OR next_attempt_at<=now()) AND ($5 OR data->>'publishNowRequested'='true' OR scheduled_at IS NULL OR scheduled_at<=now()) RETURNING *`,
      [ws(), id, lease, LEASE_SECONDS, forceDue]
    );
    if (!result.rows[0]) return null;
    await db.query(
      'INSERT INTO publication_attempts(workspace_id,job_id,lease_owner,attempt_number) VALUES($1,$2,$3,$4)',
      [ws(), id, lease, result.rows[0].attempt_count]
    );
    return hydrate(result.rows[0]);
  });
}
async function heartbeat(job) {
  return !!(
    await db.query(
      `UPDATE scheduled_posts SET lease_expires_at=now()+$4*interval '1 second' WHERE workspace_id=$1 AND id=$2 AND lease_owner=$3 AND status='processing' AND lease_expires_at>now()`,
      [ws(), job.id, job.leaseOwner, LEASE_SECONDS]
    )
  ).rowCount;
}
async function checkpoint(job, fields) {
  return !!(
    await db.query(
      `UPDATE scheduled_posts SET data=data||$4::jsonb WHERE workspace_id=$1 AND id=$2 AND lease_owner=$3 AND status='processing' AND lease_expires_at>now() AND dispatch_started_at IS NULL`,
      [ws(), job.id, job.leaseOwner, secrets.seal(fields)]
    )
  ).rowCount;
}
async function dispatch(job) {
  return !!(
    await db.query(
      `UPDATE scheduled_posts SET dispatch_started_at=now() WHERE workspace_id=$1 AND id=$2 AND lease_owner=$3 AND status='processing' AND lease_expires_at>now() AND dispatch_started_at IS NULL`,
      [ws(), job.id, job.leaseOwner]
    )
  ).rowCount;
}
async function finish(job, result) {
  return db.transaction(async () => {
    const update = await db.query(
      `UPDATE scheduled_posts SET status='completed',lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=NULL,last_error_code=NULL,last_error_message=NULL,data=data||$4::jsonb
    WHERE workspace_id=$1 AND id=$2 AND lease_owner=$3 AND status='processing' AND lease_expires_at>now() RETURNING *`,
      [
        ws(),
        job.id,
        job.leaseOwner,
        {
          status: 'completed',
          postId: result.postId,
          fbUrl: result.fbUrl,
          completedAt: new Date().toISOString()
        }
      ]
    );
    await db.query(
      'UPDATE publication_attempts SET finished_at=now(),outcome=$4,provider_result=$5 WHERE workspace_id=$1 AND job_id=$2 AND lease_owner=$3',
      [
        ws(),
        job.id,
        job.leaseOwner,
        update.rowCount ? 'published' : 'late_success',
        { postId: result.postId, fbUrl: result.fbUrl }
      ]
    );
    if (!update.rowCount) return false;
    const current = hydrate(update.rows[0]);
    await require('./storage').addHistory({
      jobId: job.id,
      facebookPageId: job.facebookPageId,
      status: 'success',
      message: current.message,
      imageUrl: current.imageUrl,
      postId: result.postId,
      fbUrl: result.fbUrl,
      source: current.source || job.kind
    });
    await db.query(
      'UPDATE publication_intents SET receipt=$3 WHERE workspace_id=$1 AND job_id=$2',
      [
        ws(),
        job.id,
        { status: 'completed', postId: result.postId, fbUrl: result.fbUrl }
      ]
    );
    return true;
  }, ws());
}
async function fail(job, error) {
  const unknown = error.delivery === 'unknown',
    retry = !unknown && error.retryable && job.attemptCount < job.maxAttempts;
  const status = unknown ? 'needs_review' : retry ? 'retry_wait' : 'failed';
  const next = retry
    ? new Date(
        Date.now() + backoff(job.attemptCount, error.retryAfter)
      ).toISOString()
    : null;
  await db.transaction(async () => {
    await db.query(
      `UPDATE scheduled_posts SET status=$4,next_attempt_at=$5,lease_owner=NULL,lease_expires_at=NULL,last_error_code=$6,last_error_message=$7,data=jsonb_set(data,'{status}',to_jsonb($4::text)) WHERE workspace_id=$1 AND id=$2 AND lease_owner=$3 AND status='processing' AND lease_expires_at>now()`,
      [
        ws(),
        job.id,
        job.leaseOwner,
        status,
        next,
        error.code || 'PUBLISH_FAILED',
        error.message
      ]
    );
    await db.query(
      'UPDATE publication_attempts SET finished_at=now(),outcome=$4,error_code=$5 WHERE workspace_id=$1 AND job_id=$2 AND lease_owner=$3',
      [ws(), job.id, job.leaseOwner, status, error.code || 'PUBLISH_FAILED']
    );
  });
  return get(job.id);
}
async function due() {
  const row = (
    await db.query(
      `SELECT * FROM scheduled_posts WHERE workspace_id=$1 AND status IN ('pending','retry_wait') AND attempt_count<max_attempts AND (scheduled_at IS NULL OR scheduled_at<=now() OR data->>'publishNowRequested'='true') AND (next_attempt_at IS NULL OR next_attempt_at<=now()) ORDER BY coalesce(next_attempt_at,scheduled_at,created_at),id LIMIT 1`,
      [ws()]
    )
  ).rows[0];
  return hydrate(row);
}
async function recover() {
  // No automatic retry is safe after a request may have been sent to Facebook.
  const result =
    await db.query(`UPDATE scheduled_posts SET status=CASE WHEN dispatch_started_at IS NOT NULL THEN 'needs_review' WHEN attempt_count>=max_attempts THEN 'failed' ELSE 'retry_wait' END,
 data=jsonb_set(data,'{status}',to_jsonb(CASE WHEN dispatch_started_at IS NOT NULL THEN 'needs_review' WHEN attempt_count>=max_attempts THEN 'failed' ELSE 'retry_wait' END::text)),
 next_attempt_at=CASE WHEN dispatch_started_at IS NULL AND attempt_count<max_attempts THEN now()+interval '30 seconds' ELSE NULL END,
 last_error_code=CASE WHEN dispatch_started_at IS NOT NULL THEN 'DELIVERY_UNKNOWN' ELSE 'WORKER_INTERRUPTED' END,
 last_error_message='Worker stopped. Dispatched requests require review; safe pre-dispatch jobs can retry.',lease_owner=NULL,lease_expires_at=NULL
 WHERE status='processing' AND lease_expires_at<now() RETURNING workspace_id,id`);
  for (const workspaceId of new Set(result.rows.map((r) => r.workspace_id)))
    await require('./event-bus').publish({
      kind: 'event',
      workspaceId,
      event: 'state_invalidated',
      data: { reason: 'jobs_recovered' }
    });
  return result.rows;
}
async function retry(id) {
  const row = await get(id);
  if (!row)
    throw Object.assign(new Error('Job not found'), {
      statusCode: 404,
      expose: true
    });
  if (
    row.status !== 'failed' ||
    !row.errorCode ||
    ['DELIVERY_UNKNOWN', 'LEGACY_IN_FLIGHT'].includes(row.errorCode)
  )
    throw Object.assign(
      new Error(
        'Only definitively failed jobs may be retried. Uncertain deliveries require manual reconciliation.'
      ),
      { statusCode: 409, expose: true }
    );
  if (row.attemptCount >= row.maxAttempts)
    throw Object.assign(
      new Error(
        'Retry budget exhausted. Review this operation before creating a new publication.'
      ),
      { statusCode: 409, expose: true }
    );
  await db.query(
    `UPDATE scheduled_posts SET status='retry_wait',next_attempt_at=now(),dispatch_started_at=NULL,data=jsonb_set(data,'{status}','"retry_wait"') WHERE workspace_id=$1 AND id=$2 AND status='failed'`,
    [ws(), id]
  );
  return get(id);
}
module.exports = {
  create,
  get,
  claim,
  heartbeat,
  checkpoint,
  dispatch,
  finish,
  fail,
  due,
  recover,
  retry,
  hydrate
};
