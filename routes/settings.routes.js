/**
 * Settings Routes
 * Manages general non-secret configurations and dedicated credential update endpoints.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const storage = require('../services/storage');
const scheduler = require('../services/scheduler');
const facebook = require('../services/facebook');
const ai = require('../services/ai');
const { broadcastSSE } = require('../middleware/sse');
const { serializeSettings } = require('../utils/public-serializer');
const { validateSettings } = require('../middleware/settings-validator');

// Strict rate limit for credential update endpoints
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many credential update attempts. Please wait.' }
});

// GET /api/settings - Returns sanitized settings without exposing secrets
router.get('/', (req, res) => {
  res.json(serializeSettings(storage.getSettings()));
});

// POST /api/settings - Update general non-secret settings
router.post('/', validateSettings, (req, res, next) => {
  try {
    const payload = { ...req.body };
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

// PUT /api/settings/gemini-credential - Dedicated endpoint for Gemini API key
router.put('/gemini-credential', credentialLimiter, (req, res) => {
  const { apiKey } = req.body || {};

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 15 || apiKey.trim().length > 300) {
    return res.status(400).json({
      success: false,
      error: 'Invalid API key format. Must be a non-empty string between 15 and 300 characters.',
      code: 'INVALID_CREDENTIAL'
    });
  }

  const cleanKey = apiKey.trim();
  storage.saveSettings({ geminiApiKey: cleanKey });

  // Broadcast updated configuration status without leaking the key
  const publicSettings = serializeSettings(storage.getSettings());
  broadcastSSE('settings_updated', publicSettings);

  return res.json({
    success: true,
    configured: true
  });
});

// PUT /api/settings/webhook-credential - Dedicated endpoint for Webhook verify token
router.put('/webhook-credential', credentialLimiter, (req, res) => {
  const { verifyToken } = req.body || {};

  if (!verifyToken || typeof verifyToken !== 'string' || verifyToken.trim().length < 8 || verifyToken.trim().length > 200) {
    return res.status(400).json({
      success: false,
      error: 'Invalid webhook verification token. Must be between 8 and 200 characters.',
      code: 'INVALID_CREDENTIAL'
    });
  }

  const cleanToken = verifyToken.trim();
  storage.saveSettings({ webhookVerifyToken: cleanToken });

  return res.json({
    success: true,
    configured: true
  });
});

// POST /api/settings/verify - Verify and save connection (returns safe metadata only)
router.post('/verify', async (req, res) => {
  const { pageId, accessToken } = req.body || {};
  if (!pageId || !accessToken) {
    return res.status(400).json({ success: false, error: 'pageId and accessToken are required.' });
  }
  try {
    const info = await facebook.verifyConnection(pageId, accessToken);
    storage.saveSettings({ pageName: info.pageName, pageId: info.pageId, accessToken });
    res.json({
      success: true,
      info: {
        pageId: info.pageId,
        pageName: info.pageName,
        category: info.category
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: 'Failed to verify Facebook Page connection.' });
  }
});

// POST /api/settings/verify-gemini - Verify and save Gemini key (returns safe metadata only)
router.post('/verify-gemini', async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey) {
    return res.status(400).json({ success: false, error: 'apiKey is required.' });
  }
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
    res.status(400).json({ success: false, error: 'Failed to verify Gemini API key.' });
  }
});

// POST /api/settings/reset-prompt
router.post('/reset-prompt', (req, res) => {
  const defaultPrompt = storage.getDefaultSystemPrompt();
  storage.saveSettings({ customSystemPrompt: defaultPrompt });
  res.json({ success: true, customSystemPrompt: defaultPrompt });
});

module.exports = router;
