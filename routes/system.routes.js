const express = require('express');
const router = express.Router();
const storage = require('../services/storage');
const scheduler = require('../services/scheduler');
const { handleSSEConnection, broadcastSSE } = require('../middleware/sse');
const { PORT } = require('../config/env');

// GET /api/events - Realtime SSE Feed
router.get('/events', handleSSEConnection);

// GET /api/status - Complete System Status
router.get('/status', async (req, res) => {
  const settings = (await storage.getSettings());
  const history = (await storage.getHistory());
  const queue = (await storage.getQueue());

  const total = history.length;
  const success = history.filter(h => h.status === 'success').length;
  const failed = history.filter(h => h.status === 'failed').length;
  const pendingQueue = queue.filter(q => q.status === 'pending').length;

  res.json({
    settings: {
      pageId: settings.pageId,
      pageName: settings.pageName,
      pictureUrl: settings.pictureUrl || '/pariksha_notes_logo.jpg',
      isDemoMode: settings.isDemoMode,
      autoPostEnabled: settings.autoPostEnabled,
      autoPilotEnabled: settings.autoPilotEnabled,
      cronSchedule: settings.cronSchedule,
      intervalMinutes: settings.intervalMinutes,
      hasToken: !!settings.accessToken
    },
    scheduler: (await scheduler.getStatus()),
    stats: {
      total,
      success,
      failed,
      pendingQueue
    }
  });
});

// GET /api/stats
router.get('/stats', async (req, res) => {
  const history = (await storage.getHistory());
  const queue = (await storage.getQueue());
  res.json({
    totalPosts: history.length,
    successfulPosts: history.filter(h => h.status === 'success').length,
    failedPosts: history.filter(h => h.status === 'failed').length,
    pendingInQueue: queue.filter(q => q.status === 'pending').length
  });
});

// GET /api/history
router.get('/history', async (req, res) => {
  res.json((await storage.getHistory()));
});

// DELETE /api/history
router.delete('/history', async (req, res) => {
  const cleared = (await storage.clearHistory());
  broadcastSSE('history_updated', cleared);
  res.json({ success: true, history: cleared });
});

// Category Management
router.get('/categories', async (req, res) => {
  res.json((await storage.getCategories()));
});

router.post('/categories', async (req, res) => {
  const { title, promptContext, icon, badge } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, error: 'Category name is required' });
  }
  const newCat = (await storage.addCategory({ title: title.trim(), promptContext, icon, badge }));
  res.json({ success: true, category: newCat, categories: (await storage.getCategories()) });
});

router.put('/categories/:id', async (req, res) => {
  const { id } = req.params;
  const { title, promptContext, icon, badge } = req.body;
  const updated = (await storage.updateCategory(id, { title, promptContext, icon, badge }));
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Category not found' });
  }
  res.json({ success: true, category: updated, categories: (await storage.getCategories()) });
});

router.delete('/categories/:id', async (req, res) => {
  const { id } = req.params;
  const remaining = (await storage.deleteCategory(id));
  res.json({ success: true, categories: remaining });
});

// GET /api/integrations
router.get('/integrations', async (req, res) => {
  const settings = (await storage.getSettings());
  res.json({
    meta: {
      connected: !!settings.accessToken,
      pageId: settings.pageId,
      pageName: settings.pageName,
      status: settings.accessToken ? 'connected' : 'disconnected'
    },
    gemini: {
      configured: !!settings.geminiApiKey,
      status: settings.geminiApiKey ? 'active' : 'unconfigured',
      model: 'gemini-3.1-flash-lite'
    },
    server: {
      uptime: Math.floor(process.uptime()),
      port: PORT,
      status: 'healthy'
    },
    scheduler: (await scheduler.getStatus())
  });
});

module.exports = router;
