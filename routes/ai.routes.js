const express = require('express');
const router = express.Router();
const ai = require('../services/ai');
const storage = require('../services/storage');
const scheduler = require('../services/scheduler');

// GET /api/ai/categories
router.get('/categories', (req, res) => {
  res.json(storage.getCategories());
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

// POST /api/ai/generate
router.post('/generate', async (req, res, next) => {
  const topic = req.body.topic || '';
  const categoryId = req.body.categoryId || req.body.category || '';
  const postStyle = req.body.postStyle || 'auto';
  const cardLayout = req.body.cardLayout || 'auto';
  const includeImage = req.body.includeImage !== false && req.body.generateImage !== false;
  const templateImage = req.body.templateImage || null;
  try {
    const bundle = await ai.generateFullPostBundle({ topic, categoryId, postStyle, cardLayout, includeImage, templateImage });
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
  const { topic = '', cardData = null, customPrompt = '', styleMode = 'auto', cardLayout = 'auto', postStyle = 'auto', variation = 1, templateImage = null } = req.body;
  try {
    const result = await ai.regenerateThumbnailOnly({ topic, cardData, customPrompt, styleMode, cardLayout, postStyle, variation, templateImage });
    res.json({ success: true, image: result.image, cardData: result.cardData, cardLayout: result.cardLayout });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/regenerate-text
router.post('/regenerate-text', async (req, res, next) => {
  const { topic = '', currentMessage = '', postStyle = 'auto', variation = 1 } = req.body;
  try {
    const result = await ai.regenerateCaptionOnly({ topic, currentMessage, postStyle, variation });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
