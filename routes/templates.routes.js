const express = require('express');
const router = express.Router();
const storage = require('../services/storage');

const ai = require('../services/ai');

// GET /api/templates - List all templates
router.get('/', async (req, res) => {
  try {
    const templates = (await storage.getTemplates());
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Operation failed. Check settings and try again.' });
  }
});

// POST /api/templates - Add a new template with optional AI learning
router.post('/', async (req, res) => {
  try {
    const { title, badge, category, imageUrl, desc, sample, learnedStyle } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Template title is required.' });
    }

    let activeLearnedStyle = learnedStyle || null;
    // Auto-analyze template style if not explicitly supplied
    if (!activeLearnedStyle && (imageUrl || sample)) {
      try {
        activeLearnedStyle = await ai.analyzeTemplate(imageUrl, sample);
      } catch (err) {
        console.log('[templates.routes] operation event');
      }
    }

    const newTemplate = (await storage.addTemplate({
      title: title.trim(),
      badge: badge ? badge.trim() : undefined,
      category: category ? category.trim() : undefined,
      imageUrl: imageUrl ? imageUrl.trim() : undefined,
      desc: desc ? desc.trim() : undefined,
      sample: sample ? sample.trim() : undefined,
      learnedStyle: activeLearnedStyle
    }));

    res.status(201).json({ success: true, template: newTemplate });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Operation failed. Check settings and try again.' });
  }
});

// DELETE /api/templates/:id - Delete a template
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Template ID is required.' });
    }

    const templates = (await storage.deleteTemplate(id));
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Operation failed. Check settings and try again.' });
  }
});

// PUT /api/templates/:id - Update a template
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const updated = (await storage.updateTemplate(id, updates));
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Template not found.' });
    }

    res.json({ success: true, template: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Operation failed. Check settings and try again.' });
  }
});

module.exports = router;
