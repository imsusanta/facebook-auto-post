const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const cron = require('node-cron');
const storage = require('./storage');
const facebook = require('./facebook');
const ai = require('./ai');
const { validateContent } = require('./content-safety');

class SchedulerService extends EventEmitter {
  constructor() {
    super();
    this.cronTask = null;
    this.queueIntervalId = null;
    this.countdownIntervalId = null;
    this.isRunning = false;
    this.nextRunTimestamp = null;
    this.isProcessing = false;
    this.lastAutoPostTime = 0;
  }

  init() {
    const settings = storage.getSettings();
    if (settings.autoPostEnabled || settings.autoPilotEnabled) {
      this.start();
    } else {
      this.nextRunTimestamp = null;
    }
  }

  /**
   * Calculate next run timestamp from Cron schedule string
   */
  computeNextRun(cronPattern) {
    if (!cronPattern) return null;

    try {
      const now = new Date();
      const parts = cronPattern.trim().split(/\s+/);
      if (parts.length !== 5) return null;

      const [minPart, hourPart] = parts;
      const targetMinutes = minPart === '*' ? [0] : minPart.split(',').map(m => parseInt(m, 10)).filter(n => !isNaN(n));
      const targetHours = hourPart.startsWith('*/')
        ? Array.from({ length: 24 }, (_, i) => i).filter(h => h % parseInt(hourPart.replace('*/', ''), 10) === 0)
        : (hourPart === '*' ? Array.from({ length: 24 }, (_, i) => i) : hourPart.split(',').map(h => parseInt(h, 10)).filter(n => !isNaN(n)));

      // Search up to 48 hours into the future
      for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
        for (const h of targetHours) {
          for (const m of targetMinutes) {
            const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m, 0, 0);
            if (candidate.getTime() > now.getTime() + 1000) {
              return candidate.getTime();
            }
          }
        }
      }
    } catch (e) {
      console.log('[Scheduler] Error computing next run:', e.message);
    }

    return null;
  }

  start() {
    const settings = storage.getSettings();
    this.stop(); // Clear any existing runners

    this.isRunning = true;
    const schedulePattern = settings.cronSchedule || '0 9,14,20 * * *';

    // 1. Cron Job for AI Auto-Pilot
    if (cron.validate(schedulePattern)) {
      try {
        this.nextRunTimestamp = this.computeNextRun(schedulePattern);

        this.cronTask = cron.schedule(schedulePattern, async () => {
          console.log(`[Scheduler] ⏰ Cron trigger activated at ${new Date().toLocaleTimeString()}!`);
          await this.executeAutoPilotTask();
          this.nextRunTimestamp = this.computeNextRun(schedulePattern);
          this.emit('status', this.getStatus());
        });

        console.log(`[Scheduler] Cron schedule active: ${schedulePattern} (${settings.cronLabel || 'Scheduled'})`);
      } catch (e) {
        console.error('[Scheduler] Cron setup failed:', e.message);
      }
    }

    // 2. Countdown ticker: update nextRunTimestamp every minute
    this.countdownIntervalId = setInterval(() => {
      if (this.isRunning && settings.cronSchedule) {
        const next = this.computeNextRun(settings.cronSchedule);
        if (next !== this.nextRunTimestamp) {
          this.nextRunTimestamp = next;
          this.emit('status', this.getStatus());
        }
      }
    }, 60 * 1000);

    // 3. Dedicated Manual Queue & Custom Time Scheduler Worker (checks every 15s)
    this.queueIntervalId = setInterval(async () => {
      const queue = storage.getQueue();
      const now = new Date();
      // An item is eligible if it has status 'pending' AND (no scheduledAt OR scheduledAt <= now)
      const eligibleItem = queue.find(item => {
        if (item.status !== 'pending') return false;
        if (!item.scheduledAt) return true; // immediate queue
        return new Date(item.scheduledAt) <= now;
      });

      if (eligibleItem && !this.isProcessing) {
        await this.processManualQueueItem(eligibleItem, queue);
      }
    }, 15 * 1000);

    this.emit('status', this.getStatus());
  }

  stop() {
    if (this.queueIntervalId) {
      clearInterval(this.queueIntervalId);
      this.queueIntervalId = null;
    }
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    this.isRunning = false;
    this.nextRunTimestamp = null;
    this.emit('status', this.getStatus());
    console.log('[Scheduler] Automation & Cron stopped.');
  }

  getStatus() {
    const settings = storage.getSettings();
    const now = Date.now();
    const remainingSeconds = this.nextRunTimestamp ? Math.max(0, Math.round((this.nextRunTimestamp - now) / 1000)) : null;

    return {
      isRunning: this.isRunning,
      autoPilotEnabled: !!settings.autoPilotEnabled,
      cronSchedule: settings.cronSchedule || '0 9,14,20 * * *',
      cronLabel: settings.cronLabel || 'প্রতিদিন ৩ বার (সকাল ৯টা, দুপুর ২টা, রাত ৮টা)',
      nextRun: this.nextRunTimestamp ? new Date(this.nextRunTimestamp).toISOString() : null,
      secondsRemaining: remainingSeconds,
      isProcessing: this.isProcessing,
      lastAutoPostTime: this.lastAutoPostTime ? new Date(this.lastAutoPostTime).toISOString() : null
    };
  }

  /**
   * Execute scheduled Auto-Pilot task strictly according to cron time
   */
  async executeAutoPilotTask() {
    const settings = storage.getSettings();
    if (!settings.autoPilotEnabled) {
      console.log('[Scheduler] Cron fired, but AI Auto-Pilot is currently turned OFF.');
      return;
    }

    // Safety check: Prevent duplicate triggers within 30 minutes
    const now = Date.now();
    if (now - this.lastAutoPostTime < 30 * 60 * 1000) {
      console.log('[Scheduler] Cooldown active: An auto-post was published recently. Skipping duplicate trigger.');
      return;
    }

    console.log('[Scheduler] Scheduled time reached! Triggering AI Auto-Pilot post...');
    await this.triggerAIAutoPilot();
  }

  /**
   * Process a single queued manual post
   */
  async processManualQueueItem(item, queue) {
    if (this.isProcessing) return;
    if (!item || item.status !== 'pending') return;

    // Guard against items requiring human review
    if (item.status === 'review_required') {
      console.log(`[Scheduler] Skipping queued item ${item.id}: manual review required.`);
      return;
    }

    this.isProcessing = true;
    this.emit('status', this.getStatus());

    try {
      console.log(`[Scheduler] Checking and posting queued item ${item.id}...`);
      item.status = 'processing';
      storage.updateQueue(queue);
      this.emit('queue_updated', queue);

      // Pre-publish safety check on queued post
      const safetyCheck = validateContent(
        { message: item.message, imageUrl: item.imageUrl },
        { history: storage.getHistory(), isAutoPilot: false }
      );

      if (!safetyCheck.safe && safetyCheck.reasons.length > 0) {
        console.warn(`[Scheduler] Item ${item.id} failed content safety check: ${safetyCheck.reasons.join('; ')}`);
        item.status = 'failed';
        item.error = `Content safety check failed: ${safetyCheck.reasons.join('; ')}`;
        storage.updateQueue(queue);

        this.emit('post_failed', { item, error: item.error, source: 'scheduler' });
        this.emit('queue_updated', queue);
        this.emit('history_updated', storage.getHistory());
        return;
      }

      let imagePath = null;
      let imageUrl = item.imageUrl;
      if (imageUrl && imageUrl.startsWith('/uploads/')) {
        const local = path.join(__dirname, '..', imageUrl);
        if (fs.existsSync(local)) {
          imagePath = local;
          imageUrl = null;
        }
      }

      const result = await facebook.publishPost({
        message: item.message,
        imagePath: imagePath,
        imageUrl: imageUrl,
        source: 'scheduler'
      });

      item.status = 'completed';
      item.completedAt = new Date().toISOString();
      item.postId = result.postId;
      storage.updateQueue(queue);

      this.emit('post_success', { item, result, source: 'scheduler' });
      this.emit('queue_updated', queue);
      this.emit('history_updated', storage.getHistory());
    } catch (err) {
      console.error(`[Scheduler] Failed to post item ${item.id}:`, err.message);
      item.status = 'failed';
      item.error = err.message;
      storage.updateQueue(queue);

      this.emit('post_failed', { item, error: err.message, source: 'scheduler' });
      this.emit('queue_updated', queue);
      this.emit('history_updated', storage.getHistory());
    } finally {
      this.isProcessing = false;
      this.emit('status', this.getStatus());
    }
  }

  /**
   * Generate and publish an AI post + thumbnail card (Auto-Pilot)
   */
  async triggerAIAutoPilot(customTopic = '') {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.emit('status', this.getStatus());
    this.emit('autopilot_generating', { timestamp: new Date().toISOString() });

    const settings = storage.getSettings();
    const activePage = storage.getActivePage();
    const pageCategory = activePage?.category || '';

    // Select category: Rotate or randomly pick from user's active categories
    const allCategories = settings.selectedCategories && settings.selectedCategories.length > 0
      ? settings.selectedCategories
      : ['trending_news', 'science_nature', 'history_civilization', 'psychology_mind', 'world_geography', 'tech_inventions', 'philosophy_wisdom'];
    
    // In unattended AutoPilot, prioritize evergreen educational categories over unverified trending news
    let eligibleCategories = allCategories;
    if (!customTopic && eligibleCategories.length > 1) {
      eligibleCategories = eligibleCategories.filter(c => c !== 'trending_news');
      if (eligibleCategories.length === 0) eligibleCategories = allCategories;
    }

    const selectedCategoryId = eligibleCategories[Math.floor(Math.random() * eligibleCategories.length)];

    try {
      console.log(`[AI Auto-Pilot] Auto-generating post for category: ${selectedCategoryId} (Page: "${activePage?.name || 'Default'}", Niche: "${pageCategory}")...`);
      
      const bundle = await ai.generateFullPostBundle({
        topic: customTopic,
        categoryId: selectedCategoryId,
        pageId: activePage?.id,
        includeImage: settings.includeAiImage !== false
      });

      // Execute Content Safety Guard
      const safetyCheck = validateContent(
        {
          message: bundle.message,
          categoryId: selectedCategoryId,
          imageUrl: bundle.image?.url,
          imagePath: bundle.image?.localPath,
          sources: bundle.sources || [],
          isAiImage: !!bundle.image
        },
        {
          history: storage.getHistory(),
          isAutoPilot: true,
          pageCategory: pageCategory
        }
      );

      // BLOCK automatic publication if safety failed OR emergency fallback was generated
      if (!safetyCheck.safe || bundle.isFallback) {
        const blockReason = !safetyCheck.safe
          ? `Content safety policy block: ${safetyCheck.reasons.join('; ')}`
          : 'Emergency static fallback generated due to AI provider outage; automatic publishing halted for quality assurance.';

        console.warn(`[AI Auto-Pilot] 🛑 Autopublish BLOCKED: ${blockReason}`);

        const queued = storage.addToQueue({
          message: bundle.message,
          imageUrl: bundle.image?.url || null,
          scheduledAt: null,
          status: 'review_required'
        });

        storage.addHistory({
          status: 'review_required',
          message: bundle.message,
          imageUrl: bundle.image?.url || null,
          error: blockReason,
          source: 'ai_autopilot'
        });

        this.emit('autopilot_held_for_review', {
          queueItem: queued,
          reasons: safetyCheck.reasons,
          warnings: safetyCheck.warnings,
          isFallback: !!bundle.isFallback
        });
        this.emit('queue_updated', storage.getQueue());
        this.emit('history_updated', storage.getHistory());

        return {
          success: false,
          reviewRequired: true,
          reason: blockReason,
          queued
        };
      }

      console.log('[AI Auto-Pilot] Content passed safety guard. Publishing post to Facebook Page...');
      
      const result = await facebook.publishPost({
        message: bundle.message,
        imagePath: bundle.image?.localPath || null,
        imageUrl: bundle.image?.url || null,
        source: 'ai_autopilot'
      });

      this.lastAutoPostTime = Date.now();

      this.emit('post_success', {
        result,
        source: 'ai_autopilot',
        message: bundle.message,
        imageUrl: bundle.image?.url
      });
      this.emit('history_updated', storage.getHistory());

      return { success: true, result, bundle };
    } catch (err) {
      console.error('[AI Auto-Pilot] Error during generation & publish:', err.message);
      this.emit('post_failed', { error: err.message, source: 'ai_autopilot' });
      this.emit('history_updated', storage.getHistory());
      throw err;
    } finally {
      this.isProcessing = false;
      this.emit('status', this.getStatus());
    }
  }

  /**
   * Run immediate trigger manually
   */
  async runNow() {
    await this.triggerAIAutoPilot();
  }
}

module.exports = new SchedulerService();
