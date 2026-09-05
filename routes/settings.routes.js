const express = require('express');
const router = express.Router();
const storage = require('../services/storage');
const scheduler = require('../services/scheduler');
const facebook = require('../services/facebook');
const ai = require('../services/ai');
const { broadcastSSE } = require('../middleware/sse');

// GET /api/settings
router.get('/', async (req, res) => {
  res.json((await storage.getSettings()));
});

// POST /api/settings
router.post('/', async (req, res, next) => {
  try {
    if (req.body.accessToken) {
      const active = await storage.getActivePage();
      if (!active) return res.status(400).json({error:'Connect a page first'});
      const info = await facebook.verifyConnection(active.id, req.body.accessToken);
      if (info.pageId !== active.id) return res.status(400).json({error:'Token does not match the active page'});
    }
    const updated = (await storage.saveSettings(req.body));
    if (updated.autoPostEnabled || updated.autoPilotEnabled) {
      (await scheduler.start());
    } else {
      (await scheduler.stop());
    }
    broadcastSSE('settings_updated', updated);
    res.json({ success: true, settings: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/verify
router.post('/verify', async (req, res) => {
  const current = await storage.getSettings();
  const pageId = req.body.pageId || current.pageId;
  const accessToken = req.body.accessToken || current.accessToken;
  try {
    const info = await facebook.verifyConnection(pageId, accessToken);
    (await storage.saveSettings({ pageName: info.pageName, pageId: info.pageId }));
    res.json({ success: true, info });
  } catch (err) {
    res.status(400).json({ success: false, error: 'Operation failed. Check settings and try again.' });
  }
});

// POST /api/settings/verify-gemini
router.post('/verify-gemini', async (req, res) => {
  const { apiKey } = req.body;
  try {
    const info = await ai.verifyGeminiKey(apiKey);
    (await storage.saveSettings({ geminiApiKey: apiKey }));
    res.json({ success: true, info });
  } catch (err) {
    res.status(400).json({ success: false, error: 'Operation failed. Check settings and try again.' });
  }
});

// POST /api/settings/reset-prompt
router.post('/reset-prompt', async (req, res) => {
  const defaultPrompt = (await storage.getDefaultSystemPrompt());
  (await storage.saveSettings({ customSystemPrompt: defaultPrompt }));
  res.json({ success: true, customSystemPrompt: defaultPrompt });
});

module.exports = router;
