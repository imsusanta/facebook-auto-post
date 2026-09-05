const express = require('express');
const router = express.Router();
const ai = require('../services/ai');
const storage = require('../services/storage');
const scheduler = require('../services/scheduler');

// GET /api/ai/categories
router.get('/categories', async (req, res) => {
  res.json((await storage.getCategories()));
});

// POST /api/ai/generate-topics
router.post('/generate-topics', async (req, res, next) => {
  const { category = '', keyword = '', count = 6 } = req.body;
  try {
    const topics = await ai.generateTopicIdeas({ category, keyword, count });
    res.json({ success: true, topics });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/analyze-template
router.post('/analyze-template', async (req, res, next) => {
  const { imageUrl, imageBase64, sampleText = '' } = req.body;
  try {
    const learnedStyle = await ai.analyzeTemplate(imageBase64 || imageUrl, sampleText);
    res.json({ success: true, learnedStyle });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/generate
router.post('/generate', async (req, res, next) => {
  const topic = req.body.topic || '';
  const categoryId = req.body.categoryId || req.body.category || '';
  const pageId = req.body.pageId || '';
  const templateId = req.body.templateId || '';
  const templateImage = req.body.templateImage || null;
  const includeImage = req.body.includeImage !== false && req.body.generateImage !== false;
  try {
    const bundle = await ai.generateFullPostBundle({ topic, categoryId, pageId, templateId, templateImage, includeImage });
    res.json({
      success: true,
      bundle,
      content: bundle?.message,
      message: bundle?.message,
      imageUrl: bundle?.image?.url
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/autopilot/trigger
router.post('/autopilot/trigger', async (req, res, next) => {
  const { topic = '' } = req.body;
  try {
    const result = await scheduler.triggerAIAutoPilot(topic);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/regenerate-image
router.post('/regenerate-image', async (req, res, next) => {
  const { topic = '', cardData = null, customPrompt = '', styleMode = 'auto', pageId = '', templateId = '', templateImage = null, variation = 1 } = req.body;
  try {
    const result = await ai.regenerateThumbnailOnly({ topic, cardData, customPrompt, styleMode, pageId, templateId, templateImage, variation });
    res.json({ success: true, image: result.image, cardData: result.cardData, cardLayout: result.cardLayout });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/regenerate-text
router.post('/regenerate-text', async (req, res, next) => {
  const { topic = '', currentMessage = '', pageId = '', templateId = '', variation = 1 } = req.body;
  try {
    const result = await ai.regenerateCaptionOnly({ topic, currentMessage, pageId, templateId, variation });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
