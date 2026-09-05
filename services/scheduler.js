const db = require('./db');
const storage = require('./storage');
const jobs = require('./jobs');
const context = require('../security/context');
const { ENABLE_AUTOMATION } = require('../config/env');
const { nextCron } = require('./scheduling');
let timer,
  busy = false,
  stopping = false;
async function sync() {
  const id = context.current().workspaceId;
  return db.transaction(async () => {
    const s = await storage.getSettings();
    const old = (
      await db.query(
        'SELECT * FROM autopilot_schedules WHERE workspace_id=$1',
        [id]
      )
    ).rows[0];
    if (!s.autoPilotEnabled) {
      if (old)
        await db.query(
          'UPDATE autopilot_schedules SET enabled=false WHERE workspace_id=$1',
          [id]
        );
      return null;
    }
    const pageId =
      s.autoPilotPageId ||
      old?.facebook_page_id ||
      (await storage.getActivePage())?.id;
    if (!pageId || !(await storage.getPageById(pageId))) {
      if (old)
        await db.query(
          'UPDATE autopilot_schedules SET enabled=false WHERE workspace_id=$1',
          [id]
        );
      return null;
    }
    const cron = s.cronSchedule || '0 9,14,20 * * *',
      zone = s.timeZone || 'UTC';
    const changed =
      !old ||
      !old.enabled ||
      old.facebook_page_id !== pageId ||
      old.cron_expression !== cron ||
      old.time_zone !== zone;
    if (changed)
      await db.query(
        `INSERT INTO autopilot_schedules(workspace_id,facebook_page_id,cron_expression,time_zone,next_run_at) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(workspace_id) DO UPDATE SET facebook_page_id=excluded.facebook_page_id,cron_expression=excluded.cron_expression,time_zone=excluded.time_zone,next_run_at=excluded.next_run_at,enabled=true,revision=autopilot_schedules.revision+1`,
        [id, pageId, cron, zone, nextCron(cron, zone)]
      );
    if (!s.autoPilotPageId)
      await storage.saveSettings({ autoPilotPageId: pageId });
    return (
      await db.query(
        'SELECT * FROM autopilot_schedules WHERE workspace_id=$1',
        [id]
      )
    ).rows[0];
  }, id);
}
async function enqueueAuto(topic = '', operationKey) {
  const s = await storage.getSettings(),
    page = await storage.getPageById(
      s.autoPilotPageId || (await storage.getActivePage())?.id
    );
  if (!page)
    throw Object.assign(new Error('Connect an autopilot page first'), {
      statusCode: 400,
      expose: true
    });
  const categories = s.selectedCategories || [];
  // Explicit user triggers are idempotent; do not re-randomize their payload on HTTP retry.
  const categoryId = categories[0] || '';
  return require('./publishing').enqueue({
    facebookPageId: page.id,
    topic,
    categoryId,
    includeImage: s.includeAiImage !== false,
    timeZone: s.timeZone || 'UTC',
    kind: 'autopilot',
    source: 'manual_autopilot',
    operationKey
  });
}
async function materializeDue() {
  const id = context.current().workspaceId;
  return db.transaction(async () => {
    await sync();
    const row = (
      await db.query(
        'SELECT * FROM autopilot_schedules WHERE workspace_id=$1 AND enabled AND next_run_at<=now() FOR UPDATE',
        [id]
      )
    ).rows[0];
    if (!row) return null;
    const s = await storage.getSettings(),
      categories = s.selectedCategories || [];
    const key = `cron:${row.facebook_page_id}:${row.revision}:${row.next_run_at.toISOString()}`;
    const job = await require('./publishing').enqueue({
      facebookPageId: row.facebook_page_id,
      topic: '',
      categoryId:
        categories[
          Math.abs(Math.floor(row.next_run_at.getTime() / 1000)) %
            Math.max(1, categories.length)
        ] || '',
      includeImage: s.includeAiImage !== false,
      timeZone: row.time_zone,
      kind: 'autopilot',
      source: 'ai_autopilot',
      operationKey: key
    });
    // Coalesce missed cron slots into one catch-up job, never a flood of old posts.
    await db.query(
      'UPDATE autopilot_schedules SET next_run_at=$2 WHERE workspace_id=$1',
      [id, nextCron(row.cron_expression, row.time_zone)]
    );
    return job;
  }, id);
}
async function getStatus() {
  const s = await storage.getSettings();
  const row = (
    await db.query(
      'SELECT * FROM autopilot_schedules WHERE workspace_id=$1 AND enabled',
      [context.current().workspaceId]
    )
  ).rows[0];
  return {
    isRunning: ENABLE_AUTOMATION && !stopping,
    autoPilotEnabled: !!s.autoPilotEnabled,
    autoPostEnabled: !!s.autoPostEnabled,
    timeZone: s.timeZone || 'UTC',
    cronSchedule: s.cronSchedule,
    cronLabel: s.cronLabel || '',
    nextRun: row?.next_run_at.toISOString() || null,
    secondsRemaining: row
      ? Math.max(0, Math.ceil((row.next_run_at.getTime() - Date.now()) / 1000))
      : null,
    isProcessing: await storage.hasProcessingJobs()
  };
}
async function tick() {
  if (busy || stopping) return;
  busy = true;
  try {
    await jobs.recover();
    const { rows } = await db.query('SELECT id FROM workspaces');
    for (const row of rows) {
      if (stopping) break;
      try {
        await context.run(row.id, async () => {
          await materializeDue();
          const s = await storage.getSettings();
          const due = (
            await db.query(
              `SELECT * FROM scheduled_posts WHERE workspace_id=$1 AND status IN ('pending','retry_wait') AND attempt_count<max_attempts
    AND (scheduled_at IS NULL OR scheduled_at<=now() OR data->>'publishNowRequested'='true') AND (next_attempt_at IS NULL OR next_attempt_at<=now())
    AND (data->>'publishNowRequested'='true' OR (kind='autopilot' AND ($2 OR data->>'source'='manual_autopilot')) OR (kind='publish' AND ($3 OR data->>'source'='manual')))
    ORDER BY coalesce(next_attempt_at,scheduled_at,created_at),id LIMIT 1`,
              [row.id, !!s.autoPilotEnabled, !!s.autoPostEnabled]
            )
          ).rows[0];
          if (due) await require('./publishing').processJob(due.id);
        });
      } catch {
        console.warn(
          '[Scheduler] Workspace tick failed; other workspaces continue'
        );
      }
    }
  } catch {
    console.warn('[Scheduler] Tick failed; persistent jobs will be revisited');
  } finally {
    busy = false;
  }
}
async function init() {
  if (!ENABLE_AUTOMATION) return;
  stopping = false;
  await jobs.recover();
  timer = setInterval(tick, 15000);
  timer.unref();
  void tick();
}
async function shutdown() {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  const deadline = Date.now() + 30000;
  while (busy && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
}
async function runNow(topic = '', key) {
  const job = await enqueueAuto(topic, key);
  return job.id
    ? require('./publishing').processJob(job.id, { forceDue: true })
    : job;
}
module.exports = {
  sync,
  start: sync,
  stop: sync,
  init,
  shutdown,
  tick,
  materializeDue,
  getStatus,
  enqueueAuto,
  triggerAIAutoPilot: runNow,
  runNow,
  processManualQueueItem: async (item) =>
    require('./publishing').processJob(item.id, { forceDue: true })
};
