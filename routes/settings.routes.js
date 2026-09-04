const express = require('express');
const router = express.Router();
const storage = require('../services/storage');
const scheduler = require('../services/scheduler');
const facebook = require('../services/facebook');
const ai = require('../services/ai');
const { broadcastSSE } = require('../middleware/sse');
const { serializeSettings } = require('../utils/public-serializer');

// GET /api/settings - Returns sanitized settings without exposing secrets
router.get('/', (req, res) => {
  res.json(serializeSettings(storage.getSettings()));
});

// POST /api/settings - Update settings with credential protection
router.post('/', (req, res, next) => {
  try {
    const payload = { ...req.body };

    // Prevent accidental erasure of secret keys if empty or not provided
    if (!payload.geminiApiKey || typeof payload.geminiApiKey !== 'string' || !payload.geminiApiKey.trim()) {
      delete payload.geminiApiKey;
    }
    if (!payload.accessToken || typeof payload.accessToken !== 'string' || !payload.accessToken.trim()) {
      delete payload.accessToken;
    }

    const updated = storage.saveSettings(payload);
    if (updated.autoPostEnabled || updated.autoPilotEnabled) {
      scheduler.start();
    } else {
      scheduler.stop();
    }

    const publicSettings = serializeSettings(updated);
    broadcastSSE('settings_updated', publicSettings);
    res.json({ success: true, settings: publicSettings });
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
    res.json({
      success: true,
      info: {
        pageId: info.pageId,
        pageName: info.pageName,
        category: info.category
      }
    });
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
    res.json({
      success: true,
      info: {
        valid: true,
        models: info.models || []
      }
    });
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
