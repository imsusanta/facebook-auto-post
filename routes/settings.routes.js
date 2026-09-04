const express = require('express');
const router = express.Router();
const storage = require('../services/storage');
const scheduler = require('../services/scheduler');
const facebook = require('../services/facebook');
const ai = require('../services/ai');
const { broadcastSSE } = require('../middleware/sse');

// GET /api/settings
router.get('/', (req, res) => {
  res.json(storage.getSettings());
});

// POST /api/settings
router.post('/', (req, res, next) => {
  try {
    const updated = storage.saveSettings(req.body);
    if (updated.autoPostEnabled || updated.autoPilotEnabled) {
      scheduler.start();
    } else {
      scheduler.stop();
    }
    broadcastSSE('settings_updated', updated);
    res.json({ success: true, settings: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/verify
router.post('/verify', async (req, res) => {
  const { pageId, accessToken } = req.body;
  try {
    const info = await facebook.verifyConnection(pageId, accessToken);
    storage.saveSettings({ pageName: info.pageName, pageId: info.pageId });
    res.json({ success: true, info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/settings/verify-gemini
router.post('/verify-gemini', async (req, res) => {
  const { apiKey } = req.body;
  try {
    const info = await ai.verifyGeminiKey(apiKey);
    storage.saveSettings({ geminiApiKey: apiKey });
    res.json({ success: true, info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/settings/reset-prompt
router.post('/reset-prompt', (req, res) => {
  const defaultPrompt = storage.getDefaultSystemPrompt();
  storage.saveSettings({ customSystemPrompt: defaultPrompt });
  res.json({ success: true, customSystemPrompt: defaultPrompt });
});

module.exports = router;
