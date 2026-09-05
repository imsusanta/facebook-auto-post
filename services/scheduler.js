const cron = require('node-cron');
const storage = require('./storage');
const db = require('./db');
const context = require('../security/context');
const { ENABLE_AUTOMATION } = require('../config/env');
const { broadcastSSE } = require('../middleware/sse');
const runners = new Map();
let poller;
async function getStatus() {
  const s = await storage.getSettings(),
    runner = runners.get(context.current().workspaceId);
  return {
    isRunning: ENABLE_AUTOMATION && !!(s.autoPostEnabled || s.autoPilotEnabled),
    autoPilotEnabled: !!s.autoPilotEnabled,
    cronSchedule: s.cronSchedule,
    cronLabel: s.cronLabel || '',
    nextRun: runner?.getNextRun()?.toISOString() || null,
    isProcessing: await storage.hasProcessingJobs()
  };
}
async function processManualQueueItem(item) {
  const claimed = await storage.claimQueueItem(item.id);
  if (!claimed) return null;
  const workspaceId = context.current().workspaceId;
  return context.run(
    workspaceId,
    async () => {
      try {
        const facebook = require('./facebook'),
          media = require('../security/media');
        const imagePath = claimed.imageUrl?.startsWith('/uploads/')
          ? await media.resolve(claimed.imageUrl)
          : null;
        const result = await facebook.publishPost({
          message: claimed.message,
          imagePath,
          imageUrl: imagePath ? null : claimed.imageUrl,
          source: 'scheduler'
        });
        await storage.updateQueueItem(item.id, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          postId: result.postId
        });
        await broadcastSSE('post_success', { result, source: 'scheduler' });
        return result;
      } catch (error) {
        // Timeouts can hide a successful Meta publish. Do not blindly retry an ambiguous result.
        await storage.updateQueueItem(item.id, {
          status: 'needs_review',
          error:
            'Publishing failed or outcome is uncertain. Check Facebook before retrying.'
        });
        await broadcastSSE('post_failed', {
          error: 'Queued post needs review'
        });
        throw error;
      } finally {
        await broadcastSSE('queue_updated', await storage.getQueue());
      }
    },
    { targetPageId: claimed.facebookPageId }
  );
}
async function triggerAIAutoPilot(topic = '') {
  const id = context.current().workspaceId;
  return db.transaction(async () => {
    const s = await storage.getSettings(),
      page = await storage.getActivePage();
    if (!page)
      throw Object.assign(new Error('Connect a page first'), {
        statusCode: 400,
        expose: true
      });
    if (
      s.lastAutoPostTime &&
      Date.now() - Date.parse(s.lastAutoPostTime) < 30 * 60 * 1000
    )
      return { skipped: true, reason: 'Cooldown active' };
    return context.run(
      id,
      async () => {
        const ai = require('./ai'),
          facebook = require('./facebook');
        const categories = s.selectedCategories || [];
        const bundle = await ai.generateFullPostBundle({
          topic,
          pageId: page.id,
          categoryId:
            categories[Math.floor(Math.random() * categories.length)] || '',
          includeImage: s.includeAiImage !== false
        });
        const result = await facebook.publishPost({
          message: bundle.message,
          imagePath: bundle.image?.localPath || null,
          source: 'ai_autopilot'
        });
        await storage.saveSettings({
          lastAutoPostTime: new Date().toISOString()
        });
        await broadcastSSE('post_success', { result, source: 'ai_autopilot' });
        return { success: true, result, bundle };
      },
      { targetPageId: page.id }
    );
  }, id);
}
async function stop() {
  const id = context.current().workspaceId;
  const old = runners.get(id);
  if (old) {
    await old.destroy();
    runners.delete(id);
  }
}
async function start() {
  await stop();
  if (!ENABLE_AUTOMATION) return;
  const s = await storage.getSettings(),
    id = context.current().workspaceId;
  if (s.autoPilotEnabled && cron.validate(s.cronSchedule))
    runners.set(
      id,
      cron.schedule(
        s.cronSchedule,
        () =>
          context.run(id, async () => {
            try {
              await triggerAIAutoPilot();
            } catch {
              console.warn('[Scheduler] Auto-pilot failed');
            }
          }),
        { timezone: 'UTC', noOverlap: true }
      )
    );
}
async function init() {
  if (!ENABLE_AUTOMATION) return;
  const { rows } = await db.query('SELECT id FROM workspaces');
  for (const row of rows) await context.run(row.id, start);
  // Preserve uncertain jobs for human reconciliation instead of publishing duplicates after a restart.
  await db.query(
    `UPDATE scheduled_posts SET status='needs_review',data=jsonb_set(data,'{status}','"needs_review"') WHERE status='processing' AND processing_at<now()-interval '15 minutes'`
  );
  let busy = false;
  poller = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { rows } = await db.query('SELECT id FROM workspaces');
      for (const w of rows)
        await context.run(w.id, async () => {
          const s = await storage.getSettings();
          if (!s.autoPostEnabled) return;
          const item = await storage.getNextDueQueueItem();
          if (item)
            try {
              await processManualQueueItem(item);
            } catch {
              console.warn('[Scheduler] Queued post requires review');
            }
        });
    } catch {
      console.warn('[Scheduler] Poll failed');
    } finally {
      busy = false;
    }
  }, 15000);
  poller.unref();
}
async function shutdown() {
  if (poller) clearInterval(poller);
  for (const job of runners.values()) await job.destroy();
  runners.clear();
}
module.exports = {
  getStatus,
  processManualQueueItem,
  triggerAIAutoPilot,
  runNow: triggerAIAutoPilot,
  start,
  stop,
  init,
  shutdown
};
