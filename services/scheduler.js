const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const cron = require('node-cron');
const defaultStorage = require('./storage');
const defaultFacebook = require('./facebook');
const defaultAi = require('./ai');
const { validateContent } = require('./content-safety');

let currentStorage = defaultStorage;
let currentFacebook = defaultFacebook;
let currentAi = defaultAi;
let currentClock = {
  now: () => Date.now(),
  newDate: (...args) => (args.length ? new Date(...args) : new Date())
};

function getDayString(date, timeZone = 'Asia/Kolkata') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
  }
}

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
    this.processingItemIds = new Set();
  }

  setDependencies({ ai: mockAi, facebook: mockFacebook, storage: mockStorage, clock: mockClock } = {}) {
    if (mockAi) currentAi = mockAi;
    if (mockFacebook) currentFacebook = mockFacebook;
    if (mockStorage) currentStorage = mockStorage;
    if (mockClock) currentClock = mockClock;
  }

  resetDependencies() {
    currentStorage = defaultStorage;
    currentFacebook = defaultFacebook;
    currentAi = defaultAi;
    currentClock = {
      now: () => Date.now(),
      newDate: (...args) => (args.length ? new Date(...args) : new Date())
    };
    this.processingItemIds.clear();
  }

  init() {
    const settings = currentStorage.getSettings();
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
      const now = currentClock.newDate();
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
    const settings = currentStorage.getSettings();
    this.stop(); // Clear any existing runners

    this.isRunning = true;
    const schedulePattern = settings.cronSchedule || '0 9,14,20 * * *';

    // 1. Cron Job for AI Auto-Pilot
    if (cron.validate(schedulePattern)) {
      try {
        this.nextRunTimestamp = this.computeNextRun(schedulePattern);

        this.cronTask = cron.schedule(schedulePattern, async () => {
          console.log(`[Scheduler] ⏰ Cron trigger activated at ${currentClock.newDate().toLocaleTimeString()}!`);
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
    if (this.countdownIntervalId.unref) this.countdownIntervalId.unref();

    // 3. Dedicated Manual Queue & Custom Time Scheduler Worker (checks every 15s)
    this.queueIntervalId = setInterval(async () => {
      const queue = currentStorage.getQueue();
      const now = currentClock.newDate();
      // An item is eligible if it has status 'pending' AND (no scheduledAt OR scheduledAt <= now)
      const eligibleItem = queue.find(item => {
        if (item.status !== 'pending') return false;
        if (this.processingItemIds.has(item.id)) return false;
        if (!item.scheduledAt) return true; // immediate queue
        return currentClock.newDate(item.scheduledAt) <= now;
      });

      if (eligibleItem && !this.isProcessing) {
        await this.processManualQueueItem(eligibleItem, queue);
      }
    }, 15 * 1000);
    if (this.queueIntervalId.unref) this.queueIntervalId.unref();

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
    const settings = currentStorage.getSettings();
    const now = currentClock.now();
    const remainingSeconds = this.nextRunTimestamp ? Math.max(0, Math.round((this.nextRunTimestamp - now) / 1000)) : null;

    return {
      isRunning: this.isRunning,
      autoPilotEnabled: !!settings.autoPilotEnabled,
      cronSchedule: settings.cronSchedule || '0 9,14,20 * * *',
      cronLabel: settings.cronLabel || 'প্রতিদিন ৩ বার (সকাল ৯টা, দুপুর ২টা, রাত ৮টা)',
      nextRun: this.nextRunTimestamp ? currentClock.newDate(this.nextRunTimestamp).toISOString() : null,
      secondsRemaining: remainingSeconds,
      isProcessing: this.isProcessing,
      lastAutoPostTime: this.lastAutoPostTime ? currentClock.newDate(this.lastAutoPostTime).toISOString() : null
    };
  }

  /**
   * Execute scheduled Auto-Pilot task strictly according to cron time
   */
  async executeAutoPilotTask() {
    const settings = currentStorage.getSettings();
    if (!settings.autoPilotEnabled) {
      console.log('[Scheduler] Cron fired, but AI Auto-Pilot is currently turned OFF.');
      return;
    }

    const activePage = currentStorage.getActivePage();
    const contentProfile = activePage?.id ? currentStorage.getPageProfile(activePage.id) : null;
    const isOnboarded = activePage && activePage.onboardingStatus && activePage.onboardingStatus !== 'not_started';
    const minGapMinutes = (isOnboarded && contentProfile?.minimumPostGapMinutes) ? contentProfile.minimumPostGapMinutes : 30;
    const minGapMs = minGapMinutes * 60 * 1000;

    // Safety check: Prevent duplicate triggers within minimum post gap
    const now = currentClock.now();
    if (this.lastAutoPostTime && (now - this.lastAutoPostTime < minGapMs)) {
      console.log(`[Scheduler] Cooldown active: An auto-post was published recently (min gap: ${minGapMinutes}m). Skipping duplicate trigger.`);
      return;
    }

    console.log('[Scheduler] Scheduled time reached! Triggering AI Auto-Pilot post...');
    await this.triggerAIAutoPilot();
  }

  /**
   * Process a single queued manual post
   */
  async processManualQueueItem(item, queue) {
    if (!item || !item.id) return;
    if (this.processingItemIds.has(item.id)) return;
    if (item.status !== 'pending') return;

    // Guard against items requiring human review
    if (item.status === 'review_required') {
      console.log(`[Scheduler] Skipping queued item ${item.id}: manual review required.`);
      return;
    }

    this.processingItemIds.add(item.id);
    this.isProcessing = true;
    this.emit('status', this.getStatus());

    try {
      console.log(`[Scheduler] Checking and posting queued item ${item.id}...`);
      item.status = 'processing';
      currentStorage.updateQueue(queue);
      this.emit('queue_updated', queue);

      const pageProfile = item.pageId
        ? currentStorage.getPageProfile(item.pageId)
        : (currentStorage.getActivePage()?.id ? currentStorage.getPageProfile(currentStorage.getActivePage().id) : null);

      // Pre-publish safety check on queued post
      const safetyCheck = validateContent(
        { message: item.message, imageUrl: item.imageUrl, contentProfile: pageProfile },
        { history: currentStorage.getHistory(), isAutoPilot: false, contentProfile: pageProfile }
      );

      if (!safetyCheck.safe && safetyCheck.reasons.length > 0) {
        console.warn(`[Scheduler] Item ${item.id} failed content safety check: ${safetyCheck.reasons.join('; ')}`);
        item.status = 'failed';
        item.error = `Content safety check failed: ${safetyCheck.reasons.join('; ')}`;
        currentStorage.updateQueue(queue);

        this.emit('post_failed', { item, error: item.error, source: 'scheduler' });
        this.emit('queue_updated', queue);
        this.emit('history_updated', currentStorage.getHistory());
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

      const result = await currentFacebook.publishPost({
        message: item.message,
        imagePath: imagePath,
        imageUrl: imageUrl,
        pageId: item.pageId || null,
        source: 'scheduler'
      });

      item.status = 'completed';
      item.completedAt = currentClock.newDate().toISOString();
      item.postId = result.postId;
      currentStorage.updateQueue(queue);

      currentStorage.addHistory({
        status: 'published',
        postId: result.postId,
        message: item.message,
        imageUrl: item.imageUrl || null,
        source: 'scheduler',
        publishedAt: item.completedAt,
        pageId: item.pageId || null,
        contentPillar: item.contentPillar || null,
        contentPillarId: item.contentPillarId || null,
        contentType: item.contentType || null,
        riskLevel: item.riskLevel || 'low',
        approvalMode: item.approvalMode || 'manual',
        profileVersion: item.profileVersion || 1
      });

      this.emit('post_success', { item, result, source: 'scheduler' });
      this.emit('queue_updated', queue);
      this.emit('history_updated', currentStorage.getHistory());
    } catch (err) {
      console.error(`[Scheduler] Failed to post item ${item.id}:`, err.message);
      item.status = 'failed';
      item.error = err.message;
      currentStorage.updateQueue(queue);

      this.emit('post_failed', { item, error: err.message, source: 'scheduler' });
      this.emit('queue_updated', queue);
      this.emit('history_updated', currentStorage.getHistory());
    } finally {
      this.processingItemIds.delete(item.id);
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
    this.emit('autopilot_generating', { timestamp: currentClock.newDate().toISOString() });

    const settings = currentStorage.getSettings();
    const activePage = currentStorage.getActivePage();
    const pageCategory = activePage?.category || '';
    const contentProfile = activePage?.id ? currentStorage.getPageProfile(activePage.id) : null;
    const isOnboarded = activePage && activePage.onboardingStatus && activePage.onboardingStatus !== 'not_started';

    // 1. Enforce maxPostsPerDay if profile is onboarded
    if (isOnboarded && contentProfile && typeof contentProfile.maxPostsPerDay === 'number' && contentProfile.maxPostsPerDay > 0) {
      const now = currentClock.newDate();
      const todayStr = getDayString(now, contentProfile.timezone);
      const history = currentStorage.getHistory() || [];
      const postsToday = history.filter(item => {
        if (item.status !== 'published' || !item.publishedAt) return false;
        if (item.pageId && activePage?.id && item.pageId !== activePage.id) return false;
        const itemDate = new Date(item.publishedAt);
        return getDayString(itemDate, contentProfile.timezone) === todayStr;
      });

      if (postsToday.length >= contentProfile.maxPostsPerDay) {
        console.log(`[AI Auto-Pilot] Daily post limit (${postsToday.length}/${contentProfile.maxPostsPerDay}) reached for today. Skipping auto-pilot.`);
        this.isProcessing = false;
        this.emit('status', this.getStatus());
        return {
          success: false,
          skipped: true,
          reason: `DAILY_POST_LIMIT_REACHED: Daily limit of ${contentProfile.maxPostsPerDay} posts reached for today.`
        };
      }
    }

    // 2. Enforce minimumPostGapMinutes if profile is onboarded
    if (isOnboarded && contentProfile && typeof contentProfile.minimumPostGapMinutes === 'number' && contentProfile.minimumPostGapMinutes > 0) {
      const minGapMs = contentProfile.minimumPostGapMinutes * 60 * 1000;
      const nowMs = currentClock.now();
      if (this.lastAutoPostTime && (nowMs - this.lastAutoPostTime < minGapMs)) {
        const remainingMins = Math.ceil((minGapMs - (nowMs - this.lastAutoPostTime)) / 60000);
        console.log(`[AI Auto-Pilot] Minimum post gap active (${remainingMins}m remaining). Skipping.`);
        this.isProcessing = false;
        this.emit('status', this.getStatus());
        return {
          success: false,
          skipped: true,
          reason: `MINIMUM_POST_GAP_ACTIVE: Minimum gap is ${contentProfile.minimumPostGapMinutes} minutes (${remainingMins}m remaining).`
        };
      }

      const history = currentStorage.getHistory() || [];
      const recentPublished = history
        .filter(h => h.status === 'published' && h.publishedAt && (!h.pageId || !activePage?.id || h.pageId === activePage.id))
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())[0];

      if (recentPublished) {
        const lastPublishedMs = new Date(recentPublished.publishedAt).getTime();
        if (!isNaN(lastPublishedMs) && (nowMs - lastPublishedMs) < minGapMs) {
          const remainingMins = Math.ceil((minGapMs - (nowMs - lastPublishedMs)) / 60000);
          console.log(`[AI Auto-Pilot] Minimum post gap active from last published post (${remainingMins}m remaining). Skipping.`);
          this.isProcessing = false;
          this.emit('status', this.getStatus());
          return {
            success: false,
            skipped: true,
            reason: `MINIMUM_POST_GAP_ACTIVE: Minimum gap is ${contentProfile.minimumPostGapMinutes} minutes (${remainingMins}m remaining).`
          };
        }
      }
    }

    // Select category: Rotate or randomly pick from user's active categories
    const allCategories = settings.selectedCategories && settings.selectedCategories.length > 0
      ? settings.selectedCategories
      : ['trending_news', 'science_nature', 'history_civilization', 'psychology_mind', 'world_geography', 'tech_inventions', 'philosophy_wisdom', 'sports_records'];
    
    // In unattended AutoPilot, prioritize evergreen educational categories over unverified trending news
    let eligibleCategories = allCategories;
    if (!customTopic && eligibleCategories.length > 1) {
      eligibleCategories = eligibleCategories.filter(c => c !== 'trending_news');
      if (eligibleCategories.length === 0) eligibleCategories = allCategories;
    }

    const selectedCategoryId = eligibleCategories[Math.floor(Math.random() * eligibleCategories.length)];

    try {
      console.log(`[AI Auto-Pilot] Auto-generating post for category: ${selectedCategoryId} (Page: "${activePage?.name || 'Default'}", Niche: "${pageCategory}")...`);
      
      const bundle = await currentAi.generateFullPostBundle({
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
          isAiImage: !!bundle.image,
          topic: customTopic,
          contentProfile: contentProfile
        },
        {
          history: currentStorage.getHistory(),
          isAutoPilot: true,
          pageCategory: pageCategory,
          contentProfile: contentProfile
        }
      );

      // Fallback policy enforcement:
      // - curated static fallbacks are NEVER auto-published unattended
      // - unverified news claims are NEVER auto-published unattended
      const isFallback = Boolean(bundle.isFallback || bundle.generationSource === 'curated_fallback');
      const isCurrentAffairs = selectedCategoryId === 'trending_news' || selectedCategoryId === 'news';
      const isUnverifiedNews = isCurrentAffairs && !bundle.verified;
      const hasSafetyIssues = !safetyCheck.safe || (safetyCheck.reasons && safetyCheck.reasons.length > 0);

      // Check approvalMode policy
      let approvalBlockReason = '';
      const approvalMode = contentProfile?.approvalMode || (isOnboarded ? 'manual' : 'low_risk_auto');

      if (isOnboarded) {
        if (approvalMode === 'manual') {
          approvalBlockReason = 'Page DNA policy requires manual operator review before publishing (approvalMode: manual).';
        } else if (approvalMode === 'low_risk_auto') {
          const riskLevel = bundle.riskLevel || 'low';
          if (riskLevel !== 'low') {
            approvalBlockReason = `Page DNA policy requires manual review for ${riskLevel}-risk content (approvalMode: low_risk_auto).`;
          }
        } else if (approvalMode === 'trusted_categories_auto') {
          const allowedTopics = Array.isArray(contentProfile?.allowedTopics)
            ? contentProfile.allowedTopics.map(t => t.toLowerCase())
            : [];
          const pillarTitle = (bundle.strategy?.pillar || '').toLowerCase();
          const categoryTitle = selectedCategoryId.toLowerCase();
          const isAllowed = allowedTopics.length > 0 && (
            allowedTopics.some(t => categoryTitle.includes(t) || t.includes(categoryTitle)) ||
            (pillarTitle && allowedTopics.some(t => pillarTitle.includes(t) || t.includes(pillarTitle)))
          );
          if (!isAllowed) {
            approvalBlockReason = `Category "${selectedCategoryId}" is not in trusted categories list; held for review (approvalMode: trusted_categories_auto).`;
          }
        }
      }

      const shouldHoldForReview = hasSafetyIssues || isFallback || isUnverifiedNews || Boolean(approvalBlockReason);

      // BLOCK automatic publication if safety failed OR fallback was generated OR unverified news OR approval required
      if (shouldHoldForReview) {
        let blockReason = '';
        const issues = [];
        if (hasSafetyIssues) {
          blockReason = `Content safety policy block: ${safetyCheck.reasons.join('; ')}`;
          issues.push(...safetyCheck.reasons);
        }
        if (isUnverifiedNews) {
          blockReason = 'News or sensitive claims cannot be auto-published without verified sources: Missing source citations or unverified claim.';
          if (!issues.includes('MISSING_SOURCE')) {
            issues.push('MISSING_SOURCE');
          }
        }
        if (isFallback) {
          blockReason = 'Curated static fallback generated; held for manual review (unverified fallbacks cannot auto-publish).';
          if (!issues.includes('CURATED_FALLBACK')) {
            issues.push('CURATED_FALLBACK');
          }
        }
        if (approvalBlockReason) {
          blockReason = approvalBlockReason;
          issues.push(approvalBlockReason);
        }

        console.warn(`[AI Auto-Pilot] 🛑 Autopublish HELD FOR REVIEW: ${blockReason}`);

        const queued = currentStorage.addToQueue({
          message: bundle.message,
          imageUrl: bundle.image?.url || null,
          scheduledAt: null,
          status: 'review_required',
          generationSource: isFallback ? 'curated_fallback' : (bundle.generationSource || 'ai_generated'),
          verified: isFallback ? false : Boolean(bundle.verified),
          issues: issues.length > 0 ? issues : [blockReason],
          pageId: activePage?.id || null,
          contentPillar: bundle.strategy?.pillar || null,
          contentPillarId: bundle.strategy?.pillarId || null,
          contentType: bundle.strategy?.contentType || null,
          riskLevel: bundle.riskLevel || 'low',
          approvalMode: approvalMode,
          profileVersion: contentProfile?.schemaVersion || 1
        });

        currentStorage.addHistory({
          status: 'review_required',
          message: bundle.message,
          imageUrl: bundle.image?.url || null,
          error: blockReason,
          source: 'ai_autopilot',
          pageId: activePage?.id || null,
          contentPillar: bundle.strategy?.pillar || null,
          contentPillarId: bundle.strategy?.pillarId || null,
          contentType: bundle.strategy?.contentType || null,
          riskLevel: bundle.riskLevel || 'low',
          approvalMode: approvalMode,
          profileVersion: contentProfile?.schemaVersion || 1
        });

        this.emit('autopilot_held_for_review', {
          queueItem: queued,
          reasons: safetyCheck.reasons,
          warnings: safetyCheck.warnings,
          isFallback
        });
        this.emit('queue_updated', currentStorage.getQueue());
        this.emit('history_updated', currentStorage.getHistory());

        return {
          success: false,
          reviewRequired: true,
          reason: blockReason,
          queued
        };
      }

      console.log('[AI Auto-Pilot] Content passed safety guard. Publishing post to Facebook Page...');
      
      const result = await currentFacebook.publishPost({
        message: bundle.message,
        imagePath: bundle.image?.localPath || null,
        imageUrl: bundle.image?.url || null,
        pageId: activePage?.id || null,
        source: 'ai_autopilot'
      });

      this.lastAutoPostTime = currentClock.now();

      currentStorage.addHistory({
        status: 'published',
        postId: result.postId,
        message: bundle.message,
        imageUrl: bundle.image?.url || null,
        source: 'ai_autopilot',
        publishedAt: currentClock.newDate().toISOString(),
        pageId: activePage?.id || null,
        contentPillar: bundle.strategy?.pillar || null,
        contentPillarId: bundle.strategy?.pillarId || null,
        contentType: bundle.strategy?.contentType || null,
        riskLevel: bundle.riskLevel || 'low',
        approvalMode: approvalMode,
        profileVersion: contentProfile?.schemaVersion || 1
      });

      this.emit('post_success', {
        result,
        source: 'ai_autopilot',
        message: bundle.message,
        imageUrl: bundle.image?.url
      });
      this.emit('history_updated', currentStorage.getHistory());

      return { success: true, result, bundle };
    } catch (err) {
      console.error('[AI Auto-Pilot] Error during generation & publish:', err.message);
      currentStorage.addHistory({
        status: 'failed',
        error: err.message,
        source: 'ai_autopilot'
      });
      this.emit('post_failed', { error: err.message, source: 'ai_autopilot' });
      this.emit('history_updated', currentStorage.getHistory());
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
